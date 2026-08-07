<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatEuro, type AuditEvent, type DocumentStatus } from '@ledgerflow/core';

type Document = {
  id: string;
  kind: 'PURCHASE' | 'SALE';
  supplier: string;
  invoiceNumber: string;
  grossCents: number;
  vatRateBasisPoints: number;
  dueDate: string;
  receivedAt: string;
  status: DocumentStatus;
  category: string;
  confidence: number;
  idempotencyKey: string;
  needsAttention: boolean;
};
type Dashboard = {
  documents: Document[];
  auditEvents: AuditEvent[];
  metrics: {
    outstandingCents: number;
    recoverableVatCents: number;
    reviewCount: number;
    postedThisMonth: number;
  };
};

const dashboard = ref<Dashboard>();
const activeFilter = ref<'ALL' | 'ATTENTION' | 'POSTED'>('ALL');
const toast = ref('');
const isLoading = ref(true);

const filteredDocuments = computed(() =>
  (dashboard.value?.documents ?? []).filter((document) => {
    if (activeFilter.value === 'ATTENTION') return document.needsAttention;
    if (activeFilter.value === 'POSTED') return document.status === 'POSTED';
    return true;
  }),
);

function euro(cents: number) {
  return formatEuro({ cents, currency: 'EUR' });
}
function statusLabel(status: DocumentStatus) {
  return status.replace('_', ' ').toLowerCase();
}
function date(value: string) {
  return new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: 'short' }).format(
    new Date(value),
  );
}

async function load() {
  isLoading.value = true;
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('Dashboard not available');
    dashboard.value = await response.json();
  } catch {
    toast.value = 'Start de API op poort 3001 om live demo-data te laden.';
  } finally {
    isLoading.value = false;
  }
}

async function advance(document: Document) {
  const next: Partial<Record<DocumentStatus, DocumentStatus>> = {
    RECEIVED: 'VALIDATED',
    VALIDATED: 'REVIEW_REQUIRED',
    REVIEW_REQUIRED: 'APPROVED',
    APPROVED: 'POSTED',
  };
  const status = next[document.status];
  if (!status) return;
  const response = await fetch(`/api/documents/${document.id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actor: 'philippe.demo' }),
  });
  if (!response.ok) {
    toast.value = 'De status kon niet wijzigen. Bekijk de correlation ID in de API-log.';
    return;
  }
  toast.value = `${document.invoiceNumber} is veilig bijgewerkt naar ${statusLabel(status)}.`;
  await load();
}

onMounted(load);
</script>

<template>
  <main>
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">L</span><span>LedgerFlow</span></div>
      <p class="workspace">Studio Godfroy<br /><span>Augustus 2026 · BE</span></p>
      <nav aria-label="Hoofdnavigatie">
        <a class="active" href="#overview">Overzicht</a>
        <a href="#documents"
          >Documenten <span>{{ dashboard?.documents.length ?? '—' }}</span></a
        >
        <a href="#audit">Audit trail</a>
        <a href="#architecture">Architectuur</a>
      </nav>
      <div class="sidebar-footer">
        <span class="pulse"></span>Systemen operationeel<br /><small
          >EU West · serverless demo</small
        >
      </div>
    </aside>

    <section class="content" id="overview">
      <header>
        <div>
          <p class="eyebrow">FINANCIAL OPERATIONS</p>
          <h1>Goedemorgen, Philippe.</h1>
          <p class="subtitle">Vandaag is er één document dat aandacht vraagt.</p>
        </div>
        <button
          class="import"
          @click="
            toast = 'Import-endpoint klaar: POST /api/documents/import met een idempotency key.'
          "
        >
          + Document importeren
        </button>
      </header>

      <p v-if="toast" class="toast" role="status">
        {{ toast }} <button @click="toast = ''">×</button>
      </p>
      <p v-if="isLoading" class="loading">Live financiële gegevens laden…</p>

      <section v-if="dashboard" class="metrics" aria-label="Financieel overzicht">
        <article>
          <p>Te ontvangen</p>
          <strong>{{ euro(dashboard.metrics.outstandingCents) }}</strong
          ><small>Geboekt deze maand</small>
        </article>
        <article>
          <p>Recupereerbare btw</p>
          <strong>{{ euro(dashboard.metrics.recoverableVatCents) }}</strong
          ><small>Indicatief · controle vereist</small>
        </article>
        <article class="attention">
          <p>Actie vereist</p>
          <strong>{{ dashboard.metrics.reviewCount }}</strong
          ><small
            >Document{{ dashboard.metrics.reviewCount === 1 ? '' : 'en' }} wachten op review</small
          >
        </article>
        <article>
          <p>Gepost</p>
          <strong>{{ dashboard.metrics.postedThisMonth }}</strong
          ><small>Document deze maand</small>
        </article>
      </section>

      <section v-if="dashboard" class="panel" id="documents">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">WERKVOORRAAD</p>
            <h2>Documenten die tellen</h2>
          </div>
          <div class="filters">
            <button :class="{ selected: activeFilter === 'ALL' }" @click="activeFilter = 'ALL'">
              Alles</button
            ><button
              :class="{ selected: activeFilter === 'ATTENTION' }"
              @click="activeFilter = 'ATTENTION'"
            >
              Aandacht</button
            ><button
              :class="{ selected: activeFilter === 'POSTED' }"
              @click="activeFilter = 'POSTED'"
            >
              Gepost
            </button>
          </div>
        </div>
        <div class="document-list">
          <div v-for="document in filteredDocuments" :key="document.id" class="document-row">
            <div class="doc-icon" :class="document.kind.toLowerCase()">
              {{ document.kind === 'PURCHASE' ? '↓' : '↑' }}
            </div>
            <div class="doc-main">
              <strong>{{ document.supplier }}</strong
              ><span>{{ document.invoiceNumber }} · {{ document.category }}</span>
            </div>
            <div class="doc-date">
              <strong>{{ date(document.dueDate) }}</strong
              ><span>Vervaldag</span>
            </div>
            <div class="doc-amount">
              <strong>{{ euro(document.grossCents) }}</strong
              ><span>{{ document.vatRateBasisPoints / 100 }}% btw</span>
            </div>
            <div>
              <span class="status" :class="document.status.toLowerCase()">{{
                statusLabel(document.status)
              }}</span
              ><small v-if="document.needsAttention"
                >{{ Math.round(document.confidence * 100) }}% herkenning</small
              >
            </div>
            <button
              v-if="!['POSTED', 'REJECTED'].includes(document.status)"
              class="advance"
              @click="advance(document)"
            >
              Volgende stap →
            </button>
          </div>
        </div>
      </section>

      <section v-if="dashboard" class="lower-grid">
        <article class="panel audit" id="audit">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">ONVERANDERBAAR LOG</p>
              <h2>Recente audit events</h2>
            </div>
            <span class="verified">● verifieerbaar</span>
          </div>
          <ol>
            <li v-for="event in dashboard.auditEvents.slice(0, 4)" :key="event.id">
              <span class="timeline-dot"></span>
              <div>
                <strong>{{ event.detail }}</strong>
                <p>{{ event.actor }} · correlation {{ event.correlationId }}</p>
              </div>
              <time>{{ date(event.occurredAt) }}</time>
            </li>
          </ol>
        </article>
        <article class="panel principles" id="architecture">
          <p class="eyebrow">INGEBOUWDE CONTROLES</p>
          <h2>Geen stille fouten.</h2>
          <ul>
            <li><b>€</b><span>Bedragen worden als integer centen verwerkt.</span></li>
            <li><b>↻</b><span>Imports zijn idempotent en dus veilig opnieuw uitvoerbaar.</span></li>
            <li><b>✓</b><span>Statusovergangen zijn expliciet en gevalideerd.</span></li>
          </ul>
        </article>
      </section>
    </section>
  </main>
</template>
