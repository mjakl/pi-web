# Performance audit lens

Use this lens for changed paths with believable latency, throughput, memory, storage, or cost impact. Do not optimize by intuition alone.

## Find the real path

Identify:

- user-facing or operational hot paths;
- expected data volume and request rate;
- loops over queries, files, network calls, or provider calls;
- batch and streaming boundaries;
- serialization, parsing, and large data movement;
- concurrency, queues, locks, and resource limits;
- caches and their invalidation behavior.

Trace representative input through the full changed path before proposing a finding.

## Concrete risks

Look for:

- N+1 storage or network calls;
- repeated expensive work inside high-cardinality loops;
- avoidable full scans, re-parsing, copying, or serialization;
- algorithms or data structures that scale poorly at expected volume;
- concurrency choices that serialize independent work or create contention;
- unbounded queues, collections, retries, or parallelism;
- resource lifetimes that leak memory, connections, files, workers, or browser sessions;
- provider calls whose fan-out creates material cost or latency.

## Caching and batching

Treat caching and batching as trade-offs, not automatic fixes.

Check:

- whether repeated work is real and material;
- whether invalidation can preserve correctness;
- whether batching changes ordering, failure isolation, or memory use;
- whether a cache creates more state and lifecycle risk than the work it saves;
- whether limits and backpressure are explicit.

## Measurement

Prefer existing profiles, query plans, timings, metrics, and representative benchmarks. When measurement is absent:

- state the scaling assumption;
- estimate the operation count or data movement from code;
- mark the concern Probable or Unverified as appropriate;
- recommend the smallest measurement that could confirm or reject it.

Do not report micro-optimizations, benchmark theater, or local allocation trivia without meaningful impact. A measurement gap belongs under risks and gaps unless the code structure already proves the problem.
