// Realistic log samples, one per supported format. Used by the unit tests
// (Rust/TypeScript parity, filters, grouping) and by the end-to-end tests.

export const LOGBACK = `2026-03-14 10:15:02,118 INFO  [main] com.acme.orders.OrderServiceApplication - Starting OrderServiceApplication
2026-03-14 10:15:03,402 DEBUG [http-nio-8080-exec-1] com.acme.orders.web.OrderController - GET /api/orders/90001 for user ravi
2026-03-14 10:15:03,950 WARN  [http-nio-8080-exec-1] com.acme.orders.repo.SlowQueryLogger - Slow query took 2140ms rows=812
2026-03-14 10:15:04,007 ERROR [http-nio-8080-exec-2] com.acme.orders.web.GlobalExceptionHandler - Unhandled exception for GET /api/orders/90002
java.lang.NullPointerException: Cannot invoke "com.acme.orders.domain.Customer.getTier()" because "customer" is null
\tat com.acme.orders.service.DiscountService.discountFor(DiscountService.java:48)
\tat com.acme.orders.web.OrderController.getOrder(OrderController.java:57)
\tat org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1089)
\tat java.base/java.lang.Thread.run(Thread.java:1583)
Caused by: java.lang.IllegalStateException: customer 4411 missing
\t... 42 common frames omitted
2026-03-14 10:15:05,300 INFO  [http-nio-8080-exec-2] com.acme.orders.web.RequestLogFilter - GET /api/orders/{id} status=500 took 311ms
2026-03-14 10:15:06,000 ERROR [http-nio-8080-exec-3] com.acme.orders.web.GlobalExceptionHandler - Unhandled exception for GET /api/orders/90007
java.lang.NullPointerException: Cannot invoke "com.acme.orders.domain.Customer.getTier()" because "customer" is null
\tat com.acme.orders.service.DiscountService.discountFor(DiscountService.java:48)
2026-03-14 10:16:10,500 INFO  [scheduling-1] com.acme.orders.metrics.HealthReporter - Heartbeat CPU_USAGE=64% HEAP_USED=512MB
`;

export const LOG4J = `2026-03-14 10:15:02.118 [main] INFO  com.acme.Billing - started in 812 ms
2026-03-14 10:15:02.500 [worker-3] ERROR com.acme.Billing - charge failed for invoice 77121
2026-03-14 10:15:02.900 [worker-3] FATAL com.acme.Billing - shutting down
`;

export const JSON_LINES = `{"@timestamp":"2026-03-14T10:15:02.118Z","level":"INFO","logger_name":"com.acme.orders.OrderService","thread_name":"main","message":"Created order","orderId":90001,"customerId":4411}
{"@timestamp":"2026-03-14T10:15:03.250Z","level":"WARN","logger_name":"com.acme.orders.cache.OrderCache","thread_name":"exec-2","traceId":"6f1c2a9b4d3e4f10a1b2c3d4e5f60718","message":"Cache miss for key order:90001","ttl":120}
{"@timestamp":"2026-03-14T10:15:04.000Z","level":"ERROR","logger_name":"com.acme.orders.web.GlobalExceptionHandler","thread_name":"exec-2","traceId":"6f1c2a9b4d3e4f10a1b2c3d4e5f60718","message":"Unhandled \\"quoted\\" failure","stack_trace":"java.lang.IllegalStateException: boom\\n\\tat com.acme.Foo.run(Foo.java:10)"}
{"time":1773483305,"level":30,"msg":"pino style line","pid":4242}
{"ts":"2026-03-14T10:15:06.5+05:30","severity":"debug","msg":"nested","ctx":{"level":"error","message":"not this one"}}
`;

export const ACCESS = `10.24.3.17 - ravi [14/Mar/2026:10:15:02 +0530] "GET /api/orders/90001 HTTP/1.1" 200 1532 "-" "curl/8.5.0"
10.24.3.18 - - [14/Mar/2026:10:15:03 +0530] "POST /api/orders HTTP/1.1" 201 312 "https://shop.example/cart" "Mozilla/5.0"
10.24.3.19 - meera [14/Mar/2026:10:15:04 +0530] "GET /api/orders/90002 HTTP/1.1" 404 87 "-" "okhttp/4.12"
10.24.3.17 - - [14/Mar/2026:10:15:09 +0530] "PATCH /api/orders/90001/status HTTP/1.1" 503 0 "-" "curl/8.5.0"
`;

export const SYSLOG = `Mar 14 10:15:02 web-1 sshd[4242]: Accepted publickey for deploy from 10.24.0.9 port 52114
Mar 14 10:15:03 web-1 kernel: [  812.553] WARNING: CPU: 2 PID: 911 at net/core/dev.c:1702
Mar 14 10:15:07 web-1 nginx[900]: ERROR upstream timed out (110: Connection timed out)
Mar  4 01:02:03 web-1 cron[77]: (root) CMD (run-parts /etc/cron.hourly)
`;

export const JUL = `Mar 14, 2026 10:15:02 AM com.acme.legacy.Importer run
INFO: Import started for batch 771
Mar 14, 2026 10:15:09 AM com.acme.legacy.Importer run
SEVERE: Import failed for batch 771
java.io.IOException: disk full
\tat com.acme.legacy.Importer.write(Importer.java:212)
Mar 14, 2026 12:00:00 PM com.acme.legacy.Importer run
WARNING: retrying
`;

export const EPOCH = `1773483302118 INFO  pool started size=10
1773483303120 ERROR pool exhausted after 5003ms
  waiting threads: 14
1773483304 WARN seconds-resolution line
1773483305.250 INFO fractional seconds
`;

export const K8S = `[orders-7d9f8b6c5-x2k4q order-service] 2026-03-14T10:15:02.118Z  INFO 1 --- [order-service] [main] c.acme.orders.OrderServiceApplication : Started
[orders-7d9f8b6c5-x2k4q order-service] 2026-03-14T10:15:03.118Z ERROR 1 --- [order-service] [exec-1] [6f1c2a9b4d3e4f10a1b2c3d4e5f60718-9a8b7c6d5e4f3a2b] c.acme.orders.web.GlobalExceptionHandler : Unhandled
[orders-7d9f8b6c5-x2k4q order-service] java.lang.IllegalStateException: boom
[orders-7d9f8b6c5-x2k4q order-service] \tat com.acme.Foo.run(Foo.java:10)
[orders-7d9f8b6c5-x2k4q istio-proxy] 2026-03-14T10:15:04.118Z WARN upstream reset
[payments-5c7d9-abcde payment-service] 1773483305118 ERROR declined card for order 90001
`;

export const GENERIC = `10:15:02 server started
10:15:03.250 listening on 0.0.0.0:8080
[10:15:04] client connected from 10.24.3.17
2026/03/14 10:15:05 rotated log file
not a timestamped line, belongs to the entry above
2026-03-14T10:15:06 traceId=6f1c2a9b4d3e4f10a1b2c3d4e5f60718 done
`;

export const PROSE = `Release notes

We shipped 3 fixes on 2026-03-14 and the build took about 10 minutes.
Order 1773483302 was refunded.
Nothing in this file is a log.
`;

export const ALL: Record<string, string> = { LOGBACK, LOG4J, JSON_LINES, ACCESS, SYSLOG, JUL, EPOCH, K8S, GENERIC, PROSE };
