<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  REVIEW_THRESHOLD,
  formatEuro,
  nextActions,
  parseEuroToCents,
  splitVat,
  type Dashboard,
  type DocumentStatus,
  type FinancialDocument,
} from '@ledgerflow/core';
import { client, LedgerRequestError } from './ledger-client';

const ACTOR = 'philippe.demo';
const dashboard = ref<Dashboard>();
const activeFilter = ref<'ALL' | 'ATTENTION' | 'POSTED'>('ALL');
const toast = ref<{ text: string; tone: 'ok' | 'error' | 'info'; correlationId?: string }>();
const isLoading = ref(true);
const loadError = ref('');
const selectedId = ref<string>();
const showImport = ref(false);
const busy = ref(false);
const showAllAudit = ref(false);

const actionLabels: Record<DocumentStatus, string> = {
  RECEIVED: 'Ontvangen',
  VALIDATED: 'Valideren',
  REVIEW_REQUIRED: 'Review vragen',
  APPROVED: 'Goedkeuren',
  POSTED: 'Boeken',
  REJECTED: 'Weigeren',
};
const statusLabels: Record<DocumentStatus, string> = {
  RECEIVED: 'ontvangen',
  VALIDATED: 'gevalideerd',
  REVIEW_REQUIRED: 'review nodig',
  APPROVED: 'goedgekeurd',
  POSTED: 'geboekt',
  REJECTED: 'geweigerd',
};

const documents = computed(() => dashboard.value?.documents ?? []);
const filteredDocuments = computed(() =>
  documents.value.filter((d) => {
    if (activeFilter.value === 'ATTENTION') return d.needsAttention;
    if (activeFilter.value === 'POSTED') return d.status === 'POSTED';
    return true;
  }),
);
const selected = computed(() => documents.value.find((d) => d.id === selectedId.value));
const selectedAudit = computed(() =>
  (dashboard.value?.auditEvents ?? []).filter((e) => e.documentId === selectedId.value),
);
const auditEvents = computed(() =>
  (dashboard.value?.auditEvents ?? []).slice(0, showAllAudit.value ? undefined : 5),
);
const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
});
const attentionSentence = computed(() => {
  const n = dashboard.value?.metrics.reviewCount ?? 0;
  if (n === 0) return 'Alles is nagekeken. Geen documenten wachten op jou.';
  return n === 1
    ? 'Er is één document dat aandacht vraagt.'
    : `Er zijn ${n} documenten die aandacht vragen.`;
});
const period = new Intl.DateTimeFormat('nl-BE', { month: 'long', year: 'numeric' }).format(
  new Date(),
);

const euro = (cents: number) => formatEuro({ cents, currency: 'EUR' });
const date = (value: string) =>
  new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: 'short' }).format(new Date(value));
const time = (value: string) =>
  new Intl.DateTimeFormat('nl-BE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const daysUntil = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

function notify(text: string, tone: 'ok' | 'error' | 'info' = 'ok', correlationId?: string) {
  toast.value = { text, tone, correlationId };
}

async function load() {
  try {
    dashboard.value = await client.dashboard();
    loadError.value = '';
  } catch {
    loadError.value =
      'De API is niet bereikbaar. Start ze met `npm run dev:api`, of open de browserdemo met `npm run dev:demo`.';
  } finally {
    isLoading.value = false;
  }
}

async function move(document: FinancialDocument, status: DocumentStatus) {
  busy.value = true;
  try {
    await client.transition(document.id, status, ACTOR);
    notify(
      `${document.invoiceNumber}: ${statusLabels[document.status]} → ${statusLabels[status]}. Audit event geschreven.`,
    );
    await load();
  } catch (error) {
    const e = error as LedgerRequestError;
    notify(
      `Geweigerd door de state machine (HTTP ${e.status}): ${e.message}`,
      'error',
      e.correlationId,
    );
    await load();
  } finally {
    busy.value = false;
  }
}

/** Deliberately tries a forbidden jump, to show the guard in action. */
function tryForbidden(document: FinancialDocument) {
  return move(document, 'POSTED');
}

const form = reactive({
  kind: 'PURCHASE' as 'PURCHASE' | 'SALE',
  supplier: 'Luminus',
  invoiceNumber: 'LUM-2026-1188',
  amount: '242,00',
  vat: 2100,
  dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  category: 'Energie',
  channel: 'mail',
});
const formError = ref('');
const formPreview = computed(() => {
  try {
    return splitVat(parseEuroToCents(form.amount), form.vat);
  } catch {
    return undefined;
  }
});
const idempotencyKey = computed(() => `${form.channel}:${form.invoiceNumber.trim().toLowerCase()}`);

async function submitImport() {
  formError.value = '';
  let grossCents: number;
  try {
    grossCents = parseEuroToCents(form.amount);
  } catch (error) {
    formError.value = (error as Error).message;
    return;
  }
  busy.value = true;
  try {
    const result = await client.import({
      kind: form.kind,
      supplier: form.supplier.trim(),
      invoiceNumber: form.invoiceNumber.trim(),
      grossCents,
      vatRateBasisPoints: form.vat,
      dueDate: form.dueDate,
      category: form.category.trim(),
      confidence: form.channel === 'peppol' ? 0.99 : 0.9,
      idempotencyKey: idempotencyKey.value,
    });
    await load();
    if (result.duplicate) {
      notify(
        `Dubbele levering herkend (sleutel ${idempotencyKey.value}). Er is niets dubbel geboekt; het bestaande document blijft staan.`,
        'info',
        result.correlationId,
      );
    } else {
      notify(
        `${result.document.invoiceNumber} ontvangen en in de wachtrij voor validatie gezet.`,
        'ok',
        result.correlationId,
      );
      showImport.value = false;
      selectedId.value = result.document.id;
    }
  } catch (error) {
    formError.value = (error as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="client.mode === 'browser'" class="demo-banner" role="note">
    <b>Live demo</b> — dezelfde domeinregels als de API, volledig in je browser. Fictieve data;
    herladen zet alles terug.
    <a href="https://github.com/phlppgdfry/ledgerflow-belgium">Broncode →</a>
  </div>
  <main>
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">L</span><span>LedgerFlow</span></div>
      <p class="workspace">
        Studio Godfroy<br /><span>{{ period }} · BE</span>
      </p>
      <nav aria-label="Hoofdnavigatie">
        <a class="active" href="#overview">Overzicht</a>
        <a href="#documents"
          >Documenten <span>{{ documents.length || '—' }}</span></a
        >
        <a href="#audit">Audit trail</a>
        <a href="#architecture">Controles</a>
      </nav>
      <div class="sidebar-footer">
        <span class="pulse"></span
        >{{ client.mode === 'browser' ? 'Browserdemo actief' : 'API verbonden' }}<br /><small>{{
          client.mode === 'browser' ? 'Geen server, geen opslag' : 'Fastify · in-memory adapter'
        }}</small>
      </div>
    </aside>

    <section class="content" id="overview">
      <header>
        <div>
          <p class="eyebrow">FINANCIAL OPERATIONS</p>
          <h1>{{ greeting }}, Philippe.</h1>
          <p class="subtitle">{{ attentionSentence }}</p>
        </div>
        <button class="import" @click="showImport = true">+ Document importeren</button>
      </header>

      <p v-if="toast" class="toast" :class="toast.tone" role="status" aria-live="polite">
        <span
          >{{ toast.text
          }}<code v-if="toast.correlationId"> correlation {{ toast.correlationId }}</code></span
        >
        <button aria-label="Melding sluiten" @click="toast = undefined">×</button>
      </p>
      <p v-if="isLoading" class="loading">Financiële gegevens laden…</p>
      <p v-if="loadError" class="toast error" role="alert">{{ loadError }}</p>

      <section v-if="dashboard" class="metrics" aria-label="Financieel overzicht">
        <article>
          <p>Te ontvangen</p>
          <strong>{{ euro(dashboard.metrics.receivableCents) }}</strong
          ><small>Geboekte verkoopfacturen</small>
        </article>
        <article>
          <p>Recupereerbare btw</p>
          <strong>{{ euro(dashboard.metrics.recoverableVatCents) }}</strong
          ><small>Per tarief berekend · indicatief</small>
        </article>
        <article :class="{ attention: dashboard.metrics.reviewCount > 0 }">
          <p>Actie vereist</p>
          <strong>{{ dashboard.metrics.reviewCount }}</strong
          ><small>Wachten op menselijke review</small>
        </article>
        <article>
          <p>Geboekt</p>
          <strong>{{ dashboard.metrics.postedCount }}</strong
          ><small>Definitief, niet meer wijzigbaar</small>
        </article>
      </section>

      <section v-if="dashboard" class="panel" id="documents">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">WERKVOORRAAD</p>
            <h2>Documenten die tellen</h2>
          </div>
          <div class="filters" role="group" aria-label="Filter">
            <button :class="{ selected: activeFilter === 'ALL' }" @click="activeFilter = 'ALL'">
              Alles
            </button>
            <button
              :class="{ selected: activeFilter === 'ATTENTION' }"
              @click="activeFilter = 'ATTENTION'"
            >
              Aandacht
            </button>
            <button
              :class="{ selected: activeFilter === 'POSTED' }"
              @click="activeFilter = 'POSTED'"
            >
              Geboekt
            </button>
          </div>
        </div>
        <div class="document-list">
          <p v-if="!filteredDocuments.length" class="empty">Niets in deze lijst.</p>
          <div
            v-for="document in filteredDocuments"
            :key="document.id"
            class="document-row"
            :class="{ selected: document.id === selectedId }"
          >
            <div
              class="doc-icon"
              :class="document.kind.toLowerCase()"
              :title="document.kind === 'PURCHASE' ? 'Aankoop' : 'Verkoop'"
            >
              {{ document.kind === 'PURCHASE' ? '↓' : '↑' }}
            </div>
            <button class="doc-main" @click="selectedId = document.id">
              <strong>{{ document.supplier }}</strong
              ><span>{{ document.invoiceNumber }} · {{ document.category }}</span>
            </button>
            <div class="doc-date">
              <strong>{{ date(document.dueDate) }}</strong>
              <span :class="{ soon: daysUntil(document.dueDate) <= 3 }">{{
                daysUntil(document.dueDate) <= 0
                  ? 'vervallen'
                  : `over ${daysUntil(document.dueDate)} d`
              }}</span>
            </div>
            <div class="doc-amount">
              <strong>{{ euro(document.grossCents) }}</strong
              ><span>{{ document.vatRateBasisPoints / 100 }}% btw</span>
            </div>
            <div>
              <span class="status" :class="document.status.toLowerCase()">{{
                statusLabels[document.status]
              }}</span>
              <small v-if="document.confidence < REVIEW_THRESHOLD && document.status !== 'POSTED'"
                >{{ Math.round(document.confidence * 100) }}% herkenning</small
              >
            </div>
            <div class="row-actions">
              <button
                v-if="nextActions(document)[0] && nextActions(document)[0] !== 'REJECTED'"
                class="advance"
                :disabled="busy"
                @click="move(document, nextActions(document)[0])"
              >
                {{ actionLabels[nextActions(document)[0]] }} →
              </button>
              <button
                class="details"
                :aria-label="`Details ${document.invoiceNumber}`"
                @click="selectedId = document.id"
              >
                ⋯
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="dashboard" class="lower-grid">
        <article class="panel audit" id="audit">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">APPEND-ONLY LOG</p>
              <h2>Audit trail</h2>
            </div>
            <button class="link" @click="showAllAudit = !showAllAudit">
              {{ showAllAudit ? 'Toon minder' : `Toon alle ${dashboard.auditEvents.length}` }}
            </button>
          </div>
          <ol>
            <li v-for="event in auditEvents" :key="event.id">
              <span class="timeline-dot" :class="event.type.toLowerCase()"></span>
              <div>
                <strong>{{ event.detail }}</strong>
                <p>{{ event.actor }} · correlation {{ event.correlationId }}</p>
              </div>
              <time :datetime="event.occurredAt">{{ date(event.occurredAt) }}</time>
            </li>
          </ol>
        </article>
        <article class="panel principles" id="architecture">
          <p class="eyebrow">INGEBOUWDE CONTROLES</p>
          <h2>Geen stille fouten.</h2>
          <ul>
            <li>
              <b>€</b
              ><span
                >Bedragen zijn integer centen; btw wordt per tarief gesplitst zonder
                afrondingslek.</span
              >
            </li>
            <li>
              <b>↻</b><span>Imports zijn idempotent: een tweede levering boekt niets dubbel.</span>
            </li>
            <li>
              <b>✓</b><span>Elke statusovergang wordt door een state machine gecontroleerd.</span>
            </li>
            <li>
              <b>%</b
              ><span
                >Onder {{ REVIEW_THRESHOLD * 100 }}% herkenning kan niets goedgekeurd worden zonder
                review.</span
              >
            </li>
          </ul>
        </article>
      </section>
    </section>

    <!-- Document detail -->
    <div v-if="selected" class="scrim" @click.self="selectedId = undefined">
      <aside
        class="drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="`Document ${selected.invoiceNumber}`"
      >
        <header>
          <div>
            <p class="eyebrow">
              {{ selected.kind === 'PURCHASE' ? 'AANKOOPFACTUUR' : 'VERKOOPFACTUUR' }}
            </p>
            <h2>{{ selected.supplier }}</h2>
            <p class="muted">{{ selected.invoiceNumber }} · {{ selected.category }}</p>
          </div>
          <button class="close" aria-label="Sluiten" @click="selectedId = undefined">×</button>
        </header>

        <span class="status big" :class="selected.status.toLowerCase()">{{
          statusLabels[selected.status]
        }}</span>

        <dl class="vat">
          <div>
            <dt>Excl. btw</dt>
            <dd>
              {{ euro(splitVat(selected.grossCents, selected.vatRateBasisPoints).net.cents) }}
            </dd>
          </div>
          <div>
            <dt>Btw {{ selected.vatRateBasisPoints / 100 }}%</dt>
            <dd>
              {{ euro(splitVat(selected.grossCents, selected.vatRateBasisPoints).vat.cents) }}
            </dd>
          </div>
          <div class="total">
            <dt>Totaal</dt>
            <dd>{{ euro(selected.grossCents) }}</dd>
          </div>
        </dl>

        <dl class="facts">
          <div>
            <dt>Vervaldag</dt>
            <dd>{{ date(selected.dueDate) }}</dd>
          </div>
          <div>
            <dt>Ontvangen</dt>
            <dd>{{ date(selected.receivedAt) }}</dd>
          </div>
          <div>
            <dt>Herkenning</dt>
            <dd :class="{ low: selected.confidence < REVIEW_THRESHOLD }">
              {{ Math.round(selected.confidence * 100) }}%
            </dd>
          </div>
          <div>
            <dt>Idempotency key</dt>
            <dd>
              <code>{{ selected.idempotencyKey }}</code>
            </dd>
          </div>
        </dl>

        <div class="drawer-actions">
          <button
            v-for="(to, i) in nextActions(selected)"
            :key="to"
            :class="to === 'REJECTED' ? 'danger' : i === 0 ? 'primary' : ''"
            :disabled="busy"
            @click="move(selected, to)"
          >
            {{ actionLabels[to] }}
          </button>
          <p v-if="!nextActions(selected).length" class="muted">
            Eindstatus: dit document kan niet meer wijzigen.
          </p>
        </div>
        <button
          v-if="!['APPROVED', 'POSTED', 'REJECTED'].includes(selected.status)"
          class="guard"
          :disabled="busy"
          @click="tryForbidden(selected)"
        >
          Test de guard: forceer meteen “geboekt”
        </button>

        <p v-if="toast" class="toast inline" :class="toast.tone" role="status" aria-live="polite">
          <span
            >{{ toast.text
            }}<code v-if="toast.correlationId"> correlation {{ toast.correlationId }}</code></span
          >
        </p>

        <h3>Geschiedenis van dit document</h3>
        <ol class="history">
          <li v-for="event in selectedAudit" :key="event.id">
            <strong>{{ event.detail }}</strong>
            <span
              >{{ time(event.occurredAt) }} · {{ event.actor }} ·
              <code>{{ event.correlationId }}</code></span
            >
          </li>
        </ol>
      </aside>
    </div>

    <!-- Import -->
    <div v-if="showImport" class="scrim" @click.self="showImport = false">
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        @submit.prevent="submitImport"
      >
        <header>
          <div>
            <p class="eyebrow">NIEUW DOCUMENT</p>
            <h2 id="import-title">Factuur importeren</h2>
          </div>
          <button type="button" class="close" aria-label="Sluiten" @click="showImport = false">
            ×
          </button>
        </header>
        <div class="grid">
          <label
            >Type<select v-model="form.kind">
              <option value="PURCHASE">Aankoop</option>
              <option value="SALE">Verkoop</option>
            </select></label
          >
          <label
            >Kanaal<select v-model="form.channel">
              <option value="mail">E-mail</option>
              <option value="upload">Upload</option>
              <option value="peppol">Peppol</option>
            </select></label
          >
          <label class="wide">Leverancier / klant<input v-model="form.supplier" required /></label>
          <label>Factuurnummer<input v-model="form.invoiceNumber" required /></label>
          <label>Categorie<input v-model="form.category" required /></label>
          <label
            >Bedrag incl. btw<input
              v-model="form.amount"
              inputmode="decimal"
              required
              placeholder="99,80"
          /></label>
          <label
            >Btw-tarief<select v-model.number="form.vat">
              <option :value="2100">21%</option>
              <option :value="1200">12%</option>
              <option :value="600">6%</option>
              <option :value="0">0%</option>
            </select></label
          >
          <label class="wide">Vervaldag<input v-model="form.dueDate" type="date" required /></label>
        </div>
        <p v-if="formPreview" class="preview">
          {{ euro(formPreview.net.cents) }} + {{ euro(formPreview.vat.cents) }} btw =
          <b>{{ euro(formPreview.gross.cents) }}</b>
        </p>
        <p class="key">
          Idempotency key <code>{{ idempotencyKey }}</code> — verstuur twee keer om te zien dat
          niets dubbel geboekt wordt.
        </p>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <div class="drawer-actions">
          <button type="submit" class="primary" :disabled="busy">Importeren</button>
          <button type="button" @click="showImport = false">Annuleren</button>
        </div>
      </form>
    </div>
  </main>
</template>
