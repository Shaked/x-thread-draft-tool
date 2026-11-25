// Observability plan O2 (#333): API tests do not write request metrics. Only metrics-record.test.js turns it on.
process.env.METRICS_DISABLED = '1'
