// Generates a realistic Spring Boot log (deterministic for a given seed).
//   node scripts/gen-log.mjs --lines 420 --seed 7 --out src/assets/sample-spring.log
//   node scripts/gen-log.mjs --mb 300 --out tmp/big.log        (size-based, for load tests)
//   --crlf writes Windows line endings
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
const targetLines = args.lines ? Number(args.lines) : Infinity;
const targetBytes = args.mb ? Number(args.mb) * 1024 * 1024 : Infinity;
const eol = args.crlf ? '\r\n' : '\n';
const outPath = args.out ?? 'tmp/sample.log';

let seed = Number(args.seed ?? 1) >>> 0;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 15)]).join('');

const APP = 'order-service';
const PID = 18244;
let now = Date.UTC(2026, 2, 14, 4, 45, 2, 118); // shown as 10:15:02.118 +05:30
const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp() {
  const d = new Date(now + 5.5 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}+05:30`;
}
function logger(name) {
  // Logback's %-40.40logger{39} abbreviation.
  const parts = name.split('.');
  let s = name;
  for (let i = 0; s.length > 40 && i < parts.length - 1; i++) {
    parts[i] = parts[i][0];
    s = parts.join('.');
  }
  return s.padEnd(40).slice(-40);
}

mkdirSync(dirname(outPath), { recursive: true });
const out = createWriteStream(outPath);
let lines = 0;
let bytes = 0;
let buf = '';
function raw(text) {
  buf += text + eol;
  lines++;
  bytes += text.length + eol.length;
  if (buf.length > 1 << 20) {
    out.write(buf);
    buf = '';
  }
}
function log(level, thread, loggerName, msg, trace = '') {
  now += int(1, 220);
  const t = trace ? `[${trace}] ` : '';
  raw(`${stamp()} ${level.padStart(5)} ${PID} --- [${APP}] [${thread.padStart(15).slice(-15)}] ${t}${logger(loggerName)} : ${msg}`);
}
function stack(frames) {
  for (const f of frames) raw(f.startsWith('Caused by') || !f.startsWith('at ') && !f.startsWith('...') ? f : `\t${f}`);
}

const FRAMEWORK = [
  'at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)',
  'at java.base/java.lang.reflect.Method.invoke(Method.java:580)',
  'at org.springframework.web.method.support.InvocableHandlerMethod.doInvoke(InvocableHandlerMethod.java:255)',
  'at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.invokeHandlerMethod(RequestMappingHandlerAdapter.java:926)',
  'at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1089)',
  'at org.springframework.security.web.FilterChainProxy.doFilterInternal(FilterChainProxy.java:233)',
  'at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:140)',
  'at org.apache.tomcat.util.net.SocketProcessorBase.run(SocketProcessorBase.java:52)',
  'at java.base/java.lang.Thread.run(Thread.java:1583)',
];

const users = ['ravi', 'meera', 'arjun', 'li.wei', 'sofia', 'omar'];
const statuses = ['CREATED', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED'];
const http = () => `nio-8080-exec-${int(1, 10)}`;
const kafkaThread = () => `ntainer#0-${int(0, 2)}-C-1`;
const trace = () => `${hex(32)}-${hex(16)}`;
let orderId = 90001;
let offset = 48210;

function startup() {
  raw('');
  raw('  .   ____          _            __ _ _');
  raw(" /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\");
  raw("( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\");
  raw(' \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )');
  raw("  '  |____| .__|_| |_|_| |_\\__, | / / / /");
  raw(' =========|_|==============|___/=/_/_/_/');
  raw(' :: Spring Boot ::                (v3.3.4)');
  raw('');
  log('INFO', 'main', 'com.acme.orders.OrderServiceApplication', `Starting OrderServiceApplication v2.8.1 using Java 21.0.4 with PID ${PID}`);
  log('INFO', 'main', 'com.acme.orders.OrderServiceApplication', 'The following 2 profiles are active: "prod", "kafka"');
  log('INFO', 'main', 'o.s.b.w.embedded.tomcat.TomcatWebServer', 'Tomcat initialized with port 8080 (http)');
  log('INFO', 'main', 'com.zaxxer.hikari.HikariDataSource', 'HikariPool-1 - Starting...');
  log('INFO', 'main', 'com.zaxxer.hikari.pool.HikariPool', 'HikariPool-1 - Added connection com.mysql.cj.jdbc.ConnectionImpl@5f2a8c11');
  log('INFO', 'main', 'com.zaxxer.hikari.HikariDataSource', 'HikariPool-1 - Start completed.');
  log('INFO', 'main', 'o.hibernate.jpa.internal.util.LogHelper', 'HHH000204: Processing PersistenceUnitInfo [name: default]');
  log('INFO', 'main', 'o.s.d.r.c.RepositoryConfigurationDelegate', 'Finished Spring Data repository scanning in 184 ms. Found 6 JPA repository interfaces.');
  log('INFO', 'main', 'io.lettuce.core.EpollProvider', 'Starting without optional epoll library');
  log('INFO', 'main', 'o.s.s.web.DefaultSecurityFilterChain', 'Will secure any request with filters: DisableEncodeUrlFilter, JwtAuthenticationFilter, AuthorizationFilter');
  log('INFO', 'main', 'o.a.k.clients.consumer.ConsumerConfig', 'ConsumerConfig values: bootstrap.servers = [kafka-1:9092, kafka-2:9092] group.id = order-service auto.offset.reset = earliest');
  log('INFO', 'main', 'o.a.k.c.c.internals.ConsumerCoordinator', '[Consumer clientId=consumer-order-service-1, groupId=order-service] Adding newly assigned partitions: payments.events-0, payments.events-1, payments.events-2');
  log('INFO', 'main', 'com.netflix.discovery.DiscoveryClient', 'DiscoveryClient_ORDER-SERVICE/order-service-7d9f8b6c5-x2k4q:8080: registering service...');
  log('INFO', 'main', 'com.netflix.discovery.DiscoveryClient', 'DiscoveryClient_ORDER-SERVICE/order-service-7d9f8b6c5-x2k4q:8080 - registration status: 204');
  log('INFO', 'main', 'o.s.b.w.embedded.tomcat.TomcatWebServer', "Tomcat started on port 8080 (http) with context path '/'");
  log('INFO', 'main', 'com.acme.orders.OrderServiceApplication', 'Started OrderServiceApplication in 6.412 seconds (process running for 7.03)');
}

function request() {
  const tr = trace();
  const th = http();
  const id = orderId++;
  const user = pick(users);
  const kind = rnd();
  if (kind < 0.45) {
    log('INFO', th, 'com.acme.orders.web.OrderController', `GET /api/orders/${id - int(1, 400)} requested by ${user}`, tr);
    if (rnd() < 0.5) log('DEBUG', th, 'com.acme.orders.cache.OrderCache', `Cache hit for key order:${id - 7} ttl=${int(20, 290)}s`, tr);
    else {
      log('DEBUG', th, 'com.acme.orders.cache.OrderCache', `Cache miss for key order:${id - 7}`, tr);
      log('DEBUG', th, 'org.hibernate.SQL', 'select o1_0.id,o1_0.customer_id,o1_0.status,o1_0.total from orders o1_0 where o1_0.id=?', tr);
    }
    log('INFO', th, 'com.acme.orders.web.RequestLogFilter', `GET /api/orders/{id} status=200 took ${int(8, 140)}ms`, tr);
  } else if (kind < 0.8) {
    log('INFO', th, 'com.acme.orders.web.OrderController', `POST /api/orders requested by ${user}`, tr);
    log('DEBUG', th, 'com.acme.orders.security.JwtAuthenticationFilter', `Validated JWT for subject=${user} roles=[ROLE_USER] expiresIn=${int(60, 3500)}s`, tr);
    log('DEBUG', th, 'com.acme.orders.client.InventoryClient', '[InventoryClient#reserve] ---> POST http://inventory-service/api/inventory/reserve HTTP/1.1', tr);
    log('DEBUG', th, 'com.acme.orders.client.InventoryClient', `[InventoryClient#reserve] <--- HTTP/1.1 200 (${int(18, 190)}ms)`, tr);
    log('DEBUG', th, 'org.hibernate.SQL', 'insert into orders (customer_id,status,total,created_at) values (?,?,?,?)', tr);
    log('INFO', th, 'com.acme.orders.service.OrderService', `Created order orderId=${id} customerId=${int(1000, 9999)} items=${int(1, 6)} total=${int(199, 48999) / 100}`, tr);
    log('INFO', th, 'com.acme.orders.events.OrderEventPublisher', `Published OrderCreated to topic=orders.events partition=${int(0, 2)} offset=${offset++} key=${id}`, tr);
    log('INFO', th, 'com.acme.orders.web.RequestLogFilter', `POST /api/orders status=201 took ${int(40, 420)}ms`, tr);
  } else {
    const from = int(0, 3);
    log('INFO', th, 'com.acme.orders.service.OrderService', `Order ${id - int(1, 300)} moved from ${statuses[from]} to ${statuses[from + 1]} by ${user}`, tr);
    log('INFO', th, 'com.acme.orders.web.RequestLogFilter', `PATCH /api/orders/{id}/status status=200 took ${int(12, 95)}ms`, tr);
  }
}

function kafka() {
  const tr = trace();
  const th = kafkaThread();
  const p = int(0, 2);
  log('INFO', th, 'com.acme.orders.events.PaymentListener', `Received PaymentCaptured topic=payments.events partition=${p} offset=${offset++} orderId=${orderId - int(1, 60)} amount=${int(199, 48999) / 100}`, tr);
  log('DEBUG', th, 'org.hibernate.SQL', 'update orders set status=?,updated_at=? where id=? and version=?', tr);
  if (rnd() < 0.15) log('WARN', th, 'com.acme.orders.events.PaymentListener', `Duplicate payment event ignored orderId=${orderId - int(1, 60)} eventId=${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`, tr);
}

function incident() {
  const tr = trace();
  const th = http();
  const kind = int(0, 5);
  if (kind === 0) {
    log('ERROR', th, 'com.acme.orders.web.GlobalExceptionHandler', `Unhandled exception for GET /api/orders/${orderId - 3}`, tr);
    stack([
      'java.lang.NullPointerException: Cannot invoke "com.acme.orders.domain.Customer.getTier()" because the return value of "com.acme.orders.domain.Order.getCustomer()" is null',
      'at com.acme.orders.service.DiscountService.discountFor(DiscountService.java:48)',
      'at com.acme.orders.service.OrderService.toView(OrderService.java:131)',
      'at com.acme.orders.web.OrderController.getOrder(OrderController.java:57)',
      ...FRAMEWORK,
    ]);
  } else if (kind === 1) {
    log('WARN', th, 'com.acme.orders.client.InventoryClient', '[InventoryClient#reserve] <--- ERROR SocketTimeoutException: Read timed out (5003ms)', tr);
    log('ERROR', th, 'com.acme.orders.service.OrderService', `Failed to reserve stock for orderId=${orderId} sku=SKU-${int(1000, 9999)} attempt=3`, tr);
    stack([
      'feign.RetryableException: Read timed out executing POST http://inventory-service/api/inventory/reserve',
      'at feign.FeignException.errorExecuting(FeignException.java:277)',
      'at feign.SynchronousMethodHandler.executeAndDecode(SynchronousMethodHandler.java:105)',
      'at com.acme.orders.service.StockReservation.reserve(StockReservation.java:39)',
      'at com.acme.orders.service.OrderService.create(OrderService.java:88)',
      'at com.acme.orders.web.OrderController.create(OrderController.java:41)',
      ...FRAMEWORK.slice(2),
      'Caused by: java.net.SocketTimeoutException: Read timed out',
      'at java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:278)',
      'at java.base/java.net.Socket$SocketInputStream.read(Socket.java:1099)',
      '... 61 common frames omitted',
    ]);
    log('INFO', th, 'com.acme.orders.web.RequestLogFilter', `POST /api/orders status=503 took ${int(15020, 15400)}ms`, tr);
  } else if (kind === 2) {
    log('ERROR', th, 'o.h.engine.jdbc.spi.SqlExceptionHelper', `Duplicate entry 'ORD-${orderId}' for key 'orders.uk_order_number'`, tr);
    log('ERROR', th, 'com.acme.orders.web.GlobalExceptionHandler', 'Unhandled exception for POST /api/orders', tr);
    stack([
      'org.springframework.dao.DataIntegrityViolationException: could not execute statement [Duplicate entry] [insert into orders (customer_id,status,total,created_at) values (?,?,?,?)]; SQL [n/a]; constraint [orders.uk_order_number]',
      'at org.springframework.orm.jpa.vendor.HibernateJpaDialect.convertHibernateAccessException(HibernateJpaDialect.java:290)',
      'at org.springframework.transaction.interceptor.TransactionInterceptor.invoke(TransactionInterceptor.java:119)',
      'at com.acme.orders.service.OrderService$$SpringCGLIB$$0.create(<generated>)',
      'at com.acme.orders.web.OrderController.create(OrderController.java:41)',
      ...FRAMEWORK.slice(2),
      'Caused by: org.hibernate.exception.ConstraintViolationException: could not execute statement',
      'at org.hibernate.exception.internal.SQLExceptionTypeDelegate.convert(SQLExceptionTypeDelegate.java:62)',
      '... 138 common frames omitted',
      `Caused by: java.sql.SQLIntegrityConstraintViolationException: Duplicate entry 'ORD-${orderId}' for key 'orders.uk_order_number'`,
      'at com.mysql.cj.jdbc.exceptions.SQLError.createSQLException(SQLError.java:118)',
      'at com.mysql.cj.jdbc.ClientPreparedStatement.executeInternal(ClientPreparedStatement.java:912)',
      '... 152 common frames omitted',
    ]);
  } else if (kind === 3) {
    log('WARN', th, 'com.acme.orders.security.JwtAuthenticationFilter', `Rejected request: JWT expired at 2026-03-14T04:${pad(int(10, 44))}:${pad(int(0, 59))}Z for subject=${pick(users)} ip=10.24.${int(0, 9)}.${int(2, 250)}`, tr);
    log('INFO', th, 'com.acme.orders.web.RequestLogFilter', `GET /api/orders status=401 took ${int(1, 6)}ms`, tr);
  } else if (kind === 4) {
    const th2 = kafkaThread();
    log('WARN', th2, 'o.a.k.c.c.internals.ConsumerCoordinator', '[Consumer clientId=consumer-order-service-1, groupId=order-service] consumer poll timeout has expired. This means the time between subsequent calls to poll() was longer than the configured max.poll.interval.ms');
    log('INFO', th2, 'o.a.k.c.c.internals.ConsumerCoordinator', '[Consumer clientId=consumer-order-service-1, groupId=order-service] Revoke previously assigned partitions payments.events-0, payments.events-1, payments.events-2');
    log('INFO', th2, 'o.a.k.c.c.internals.ConsumerCoordinator', `[Consumer clientId=consumer-order-service-1, groupId=order-service] Successfully joined group with generation Generation{generationId=${int(12, 90)}, memberId='consumer-order-service-1-${hex(8)}', protocol='range'}`);
  } else {
    log('WARN', th, 'com.acme.orders.repo.SlowQueryLogger', `Slow query took ${int(1200, 4800)}ms rows=${int(200, 9000)} sql=select * from order_items where order_id in (...)`, tr);
    log('WARN', 'HikariPool-1 housekeeper', 'com.zaxxer.hikari.pool.HikariPool', `HikariPool-1 - Thread starvation or clock leap detected (housekeeper delta=${int(45, 58)}s${int(100, 900)}ms).`);
  }
}

startup();
while (lines < targetLines && bytes < targetBytes) {
  const r = rnd();
  if (r < 0.62) request();
  else if (r < 0.9) kafka();
  else incident();
  if (rnd() < 0.03) {
    now += int(4000, 30000);
    log('INFO', 'scheduling-1', 'com.acme.orders.metrics.HealthReporter', `Heartbeat CPU_USAGE=${int(12, 91)}% HEAP_USED=${int(180, 760)}MB activeConnections=${int(2, 10)}/10 redis=10.24.3.17:6379`);
  }
}
out.end(buf, () => console.log(`${outPath}: ${lines} lines, ${(bytes / 1048576).toFixed(2)} MB`));
