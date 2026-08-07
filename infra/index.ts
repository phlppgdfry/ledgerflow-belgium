import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const enableSearch = config.getBoolean('enableSearch') ?? false;

const documents = new aws.dynamodb.Table('documents', {
  billingMode: 'PAY_PER_REQUEST',
  hashKey: 'PK',
  rangeKey: 'SK',
  attributes: [
    { name: 'PK', type: 'S' },
    { name: 'SK', type: 'S' },
  ],
  pointInTimeRecovery: { enabled: true },
  serverSideEncryption: { enabled: true },
  tags: { service: 'ledgerflow', dataClassification: 'financial-demo' },
});

const deadLetterQueue = new aws.sqs.Queue('document-processing-dlq', {
  messageRetentionSeconds: 1_209_600,
  sqsManagedSseEnabled: true,
});
const processingQueue = new aws.sqs.Queue('document-processing', {
  visibilityTimeoutSeconds: 180,
  sqsManagedSseEnabled: true,
  redrivePolicy: deadLetterQueue.arn.apply((deadLetterTargetArn) =>
    JSON.stringify({ deadLetterTargetArn, maxReceiveCount: 3 }),
  ),
});
const events = new aws.sns.Topic('financial-events', { fifoTopic: false });

const lambdaRole = new aws.iam.Role('ledgerflow-lambda-role', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
});
new aws.iam.RolePolicyAttachment('lambda-logs', {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});
new aws.iam.RolePolicy('ledgerflow-data-access', {
  role: lambdaRole.id,
  policy: pulumi
    .all([documents.arn, processingQueue.arn, events.arn])
    .apply(([tableArn, queueArn, topicArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
            ],
            Resource: tableArn,
          },
          {
            Effect: 'Allow',
            Action: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage'],
            Resource: queueArn,
          },
          { Effect: 'Allow', Action: 'sns:Publish', Resource: topicArn },
        ],
      }),
    ),
});

const apiHandler = new aws.lambda.CallbackFunction('ledgerflow-api', {
  role: lambdaRole,
  timeout: 15,
  memorySize: 512,
  environment: {
    variables: {
      DOCUMENTS_TABLE: documents.name,
      PROCESSING_QUEUE_URL: processingQueue.url,
      EVENTS_TOPIC_ARN: events.arn,
    },
  },
  callback: async () => ({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'ledgerflow-api', status: 'ok' }),
  }),
});

const api = new aws.apigatewayv2.Api('ledgerflow-http-api', {
  protocolType: 'HTTP',
  corsConfiguration: {
    allowOrigins: ['*'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type', 'idempotency-key'],
  },
});
const integration = new aws.apigatewayv2.Integration('ledgerflow-integration', {
  apiId: api.id,
  integrationType: 'AWS_PROXY',
  integrationUri: apiHandler.arn,
  payloadFormatVersion: '2.0',
});
new aws.apigatewayv2.Route('health-route', {
  apiId: api.id,
  routeKey: 'GET /health',
  target: pulumi.interpolate`integrations/${integration.id}`,
});
new aws.lambda.Permission('allow-api-gateway', {
  action: 'lambda:InvokeFunction',
  function: apiHandler.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
});

let searchDomain: aws.opensearch.Domain | undefined;
if (enableSearch) {
  searchDomain = new aws.opensearch.Domain('ledgerflow-search', {
    engineVersion: 'OpenSearch_2.11',
    clusterConfig: { instanceType: 't3.small.search', instanceCount: 1 },
    ebsOptions: { ebsEnabled: true, volumeSize: 10, volumeType: 'gp3' },
    encryptAtRest: { enabled: true },
    nodeToNodeEncryption: { enabled: true },
    domainEndpointOptions: { enforceHttps: true },
  });
}

export const apiUrl = api.apiEndpoint;
export const documentsTable = documents.name;
export const queueUrl = processingQueue.url;
export const dlqUrl = deadLetterQueue.url;
export const searchEndpoint =
  searchDomain?.endpoint ?? 'disabled (set enableSearch=true to create)';
