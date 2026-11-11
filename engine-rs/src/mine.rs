//! Template mining ("auto tables"): groups log messages that share a shape.
//!
//! Each message is split into tokens; tokens that look variable (numbers, ids,
//! key=value values, quoted strings, paths with ids) are masked. Messages with
//! the same masked tokens form a template. A second pass merges templates of
//! the same length that differ in only a few positions.
//!
//! The TypeScript twin is `src/engine/mine.ts`; `tests/unit/mine.test.ts`
//! compares the two. Keep them the same shape.

use std::collections::HashMap;

pub const KIND_LITERAL: u8 = 0;
pub const KIND_VAR: u8 = 1;
/// A path whose id-like segments were replaced: the text is the route, the value the real path.
pub const KIND_PATH: u8 = 2;
/// A position where merged templates had different words.
pub const KIND_MERGED: u8 = 3;

pub const MAX_TOKENS: usize = 48;
pub const MAX_MESSAGE: usize = 800;

#[derive(Clone, PartialEq, Eq)]
pub struct Tok {
    pub kind: u8,
    pub text: Vec<u8>,
}

struct Tpl {
    tokens: Vec<Tok>,
    count: u32,
    first: u32,
}

#[derive(Default)]
pub struct Miner {
    map: HashMap<Vec<u8>, u32>,
    templates: Vec<Tpl>,
    ids: Vec<u32>,
}

#[inline]
fn is_digit(b: u8) -> bool {
    b >= b'0' && b <= b'9'
}

#[inline]
fn is_alpha(b: u8) -> bool {
    (b >= b'a' && b <= b'z') || (b >= b'A' && b <= b'Z')
}

/// Splits a message into tokens at spaces and tabs; quoted text stays together.
pub fn tokenize(msg: &[u8]) -> Vec<(usize, usize)> {
    let n = msg.len();
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < n {
        while i < n && (msg[i] == b' ' || msg[i] == b'\t') {
            i += 1;
        }
        if i >= n {
            break;
        }
        if out.len() == MAX_TOKENS {
            // Too long to compare token by token: the rest is one token.
            out.push((i, n));
            break;
        }
        let start = i;
        let mut quote = 0u8;
        while i < n {
            let b = msg[i];
            if quote != 0 {
                if b == quote {
                    quote = 0;
                }
            } else if b == b'"' {
                quote = b'"';
            } else if b == b'\'' && (i == start || msg[i - 1] == b'=') {
                quote = b'\'';
            } else if b == b' ' || b == b'\t' {
                break;
            }
            i += 1;
        }
        out.push((start, i));
    }
    out
}

/// Length of a leading number (sign, digits, groups after '.' or ','), or 0.
fn number_len(v: &[u8]) -> usize {
    let n = v.len();
    let mut i = 0;
    if i < n && (v[i] == b'-' || v[i] == b'+') {
        i += 1;
    }
    let digits = i;
    while i < n && is_digit(v[i]) {
        i += 1;
    }
    if i == digits {
        return 0;
    }
    while i + 1 < n && (v[i] == b'.' || v[i] == b',') && is_digit(v[i + 1]) {
        i += 1;
        while i < n && is_digit(v[i]) {
            i += 1;
        }
    }
    i
}

/// For "84ms" returns (2, 4): the number ends at 2 and the unit at 4. (0, 0) if not number+unit.
fn number_unit(v: &[u8]) -> (usize, usize) {
    let k = number_len(v);
    if k == 0 {
        return (0, 0);
    }
    let rest = &v[k..];
    if rest.is_empty() {
        return (k, k);
    }
    if rest == b"%" {
        return (k, k + 1);
    }
    if rest.len() <= 3 && rest.iter().all(|b| is_alpha(*b)) {
        return (k, v.len());
    }
    (0, 0)
}

fn has_digit(v: &[u8]) -> bool {
    v.iter().any(|b| is_digit(*b))
}

/// Start and end of the token's core, without one opening bracket and trailing punctuation.
pub fn core_span(tok: &[u8]) -> (usize, usize) {
    let n = tok.len();
    let mut p = 0;
    if n > 1 && (tok[0] == b'(' || tok[0] == b'[' || tok[0] == b'{' || tok[0] == b'<') {
        p = 1;
    }
    let mut s = n;
    while s > p + 1 {
        let b = tok[s - 1];
        if b == b',' || b == b';' || b == b':' || b == b'.' || b == b')' || b == b']' || b == b'}' || b == b'>' {
            s -= 1;
        } else {
            break;
        }
    }
    (p, s)
}

/// Position of '=' when the core is key=value with an identifier-like key, else 0.
pub fn key_len(core: &[u8]) -> usize {
    if core.is_empty() || !(is_alpha(core[0]) || core[0] == b'_') {
        return 0;
    }
    let mut k = 0;
    while k < core.len() {
        let b = core[k];
        if b == b'=' {
            return k;
        }
        if !(is_alpha(b) || is_digit(b) || b == b'_' || b == b'.' || b == b'-') {
            return 0;
        }
        k += 1;
    }
    0
}

/// Masks one token: what it looks like in a template, and what kind it is.
pub fn classify(tok: &[u8]) -> Tok {
    let (p, s) = core_span(tok);
    let core = &tok[p..s];
    let wrap = |kind: u8, middle: &[u8]| -> Tok {
        let mut text = Vec::with_capacity(tok.len() + 4);
        text.extend_from_slice(&tok[..p]);
        text.extend_from_slice(middle);
        text.extend_from_slice(&tok[s..]);
        Tok { kind, text }
    };
    if core.is_empty() {
        return Tok { kind: KIND_LITERAL, text: tok.to_vec() };
    }
    // "quoted text"
    if core.len() >= 2 && (core[0] == b'"' || core[0] == b'\'') {
        return wrap(KIND_VAR, b"<*>");
    }
    // key=value: the value always varies; a unit on the value is kept.
    let k = key_len(core);
    if k > 0 {
        let value = &core[k + 1..];
        let (num, unit) = number_unit(value);
        let mut middle = core[..k + 1].to_vec();
        middle.extend_from_slice(b"<*>");
        if num > 0 {
            middle.extend_from_slice(&value[num..unit]);
        }
        return wrap(KIND_VAR, &middle);
    }
    // /api/orders/90001 -> /api/orders/{id}
    if core[0] == b'/' && core.len() > 1 {
        let mut route: Vec<u8> = Vec::with_capacity(core.len());
        let mut replaced = false;
        let mut i = 1;
        let n = core.len();
        loop {
            let seg = i;
            while i < n && core[i] != b'/' && core[i] != b'?' {
                i += 1;
            }
            route.push(b'/');
            if has_digit(&core[seg..i]) {
                route.extend_from_slice(b"{id}");
                replaced = true;
            } else {
                route.extend_from_slice(&core[seg..i]);
            }
            if i >= n || core[i] == b'?' {
                break;
            }
            i += 1;
        }
        if i < n {
            // A query string is variable too.
            replaced = true;
        }
        if replaced {
            return wrap(KIND_PATH, &route);
        }
        return Tok { kind: KIND_LITERAL, text: tok.to_vec() };
    }
    // 84ms, 64%, 1,299.50
    let (num, unit) = number_unit(core);
    if num > 0 {
        let mut middle = b"<*>".to_vec();
        middle.extend_from_slice(&core[num..unit]);
        return wrap(KIND_VAR, &middle);
    }
    // Anything else with a digit in it: ids, hashes, addresses, versions, dates.
    if has_digit(core) {
        return wrap(KIND_VAR, b"<*>");
    }
    Tok { kind: KIND_LITERAL, text: tok.to_vec() }
}

fn key_of(tokens: &[Tok]) -> Vec<u8> {
    let mut key = Vec::with_capacity(tokens.iter().map(|t| t.text.len() + 2).sum());
    for t in tokens {
        key.push(t.kind + 1);
        key.extend_from_slice(&t.text);
        key.push(0x1f);
    }
    key
}

impl Miner {
    pub fn new() -> Miner {
        Miner::default()
    }

    /// Adds one message; returns its provisional template id.
    pub fn add(&mut self, msg: &[u8]) -> u32 {
        let msg = if msg.len() > MAX_MESSAGE { &msg[..MAX_MESSAGE] } else { msg };
        let tokens: Vec<Tok> = tokenize(msg).iter().map(|(a, b)| classify(&msg[*a..*b])).collect();
        let key = key_of(&tokens);
        let entry = self.ids.len() as u32;
        let id = match self.map.get(&key) {
            Some(id) => {
                self.templates[*id as usize].count += 1;
                *id
            }
            None => {
                let id = self.templates.len() as u32;
                self.templates.push(Tpl { tokens, count: 1, first: entry });
                self.map.insert(key, id);
                id
            }
        };
        self.ids.push(id);
        id
    }

    /// Marks an entry that takes no part in mining (for example an access-log line).
    pub fn skip(&mut self) {
        self.ids.push(u32::MAX);
    }

    /// Merges near-identical templates. Returns the final id of every entry and
    /// the templates serialised as: u32 count; then per template u32 count,
    /// u32 first entry, u32 tokens; per token u8 kind, u32 length, bytes.
    pub fn finish(self) -> (Vec<u32>, Vec<u8>) {
        struct Group {
            tokens: Vec<Tok>,
            count: u32,
            first: u32,
        }
        let mut groups: Vec<Group> = Vec::new();
        // (length, first token) -> groups, in creation order
        let mut buckets: HashMap<Vec<u8>, Vec<u32>> = HashMap::new();
        let mut remap: Vec<u32> = Vec::with_capacity(self.templates.len());
        for t in self.templates.into_iter() {
            let len = t.tokens.len();
            let mut target: Option<u32> = None;
            let mut bucket_key: Vec<u8> = Vec::new();
            if len >= 4 {
                bucket_key.extend_from_slice(&(len as u32).to_le_bytes());
                bucket_key.push(t.tokens[0].kind);
                bucket_key.extend_from_slice(&t.tokens[0].text);
                let allowed = if len == 4 { 1 } else { len * 2 / 5 };
                if let Some(list) = buckets.get(&bucket_key) {
                    for gi in list {
                        let g = &groups[*gi as usize];
                        let mut diff = 0;
                        for i in 0..len {
                            if g.tokens[i].kind != KIND_MERGED && g.tokens[i] != t.tokens[i] {
                                diff += 1;
                            }
                        }
                        if diff <= allowed {
                            target = Some(*gi);
                            break;
                        }
                    }
                }
            }
            match target {
                Some(gi) => {
                    let g = &mut groups[gi as usize];
                    for i in 0..len {
                        if g.tokens[i].kind != KIND_MERGED && g.tokens[i] != t.tokens[i] {
                            g.tokens[i] = Tok { kind: KIND_MERGED, text: b"<*>".to_vec() };
                        }
                    }
                    g.count += t.count;
                    if t.first < g.first {
                        g.first = t.first;
                    }
                    remap.push(gi);
                }
                None => {
                    let gi = groups.len() as u32;
                    groups.push(Group { tokens: t.tokens, count: t.count, first: t.first });
                    if len >= 4 {
                        buckets.entry(bucket_key).or_default().push(gi);
                    }
                    remap.push(gi);
                }
            }
        }
        let ids: Vec<u32> = self.ids.iter().map(|id| if *id == u32::MAX { u32::MAX } else { remap[*id as usize] }).collect();
        let mut blob: Vec<u8> = Vec::new();
        blob.extend_from_slice(&(groups.len() as u32).to_le_bytes());
        for g in &groups {
            blob.extend_from_slice(&g.count.to_le_bytes());
            blob.extend_from_slice(&g.first.to_le_bytes());
            blob.extend_from_slice(&(g.tokens.len() as u32).to_le_bytes());
            for t in &g.tokens {
                blob.push(t.kind);
                blob.extend_from_slice(&(t.text.len() as u32).to_le_bytes());
                blob.extend_from_slice(&t.text);
            }
        }
        (ids, blob)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn masked(msg: &str) -> String {
        tokenize(msg.as_bytes()).iter().map(|(a, b)| String::from_utf8(classify(&msg.as_bytes()[*a..*b]).text).unwrap()).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn masks_variable_tokens() {
        assert_eq!(masked("GET /api/orders/{id} status=200 took 84ms"), "GET /api/orders/{id} status=<*> took <*>ms");
        assert_eq!(masked("GET /api/orders/90001 requested by ravi"), "GET /api/orders/{id} requested by ravi");
        assert_eq!(masked("Heartbeat CPU_USAGE=64% HEAP_USED=512MB redis=10.24.3.17:6379"), "Heartbeat CPU_USAGE=<*>% HEAP_USED=<*>MB redis=<*>");
        assert_eq!(masked("Duplicate entry 'ORD-1' for key \"uk order\""), "Duplicate entry <*> for key <*>");
        assert_eq!(masked("Started in 6.412 seconds (process running for 7.03)"), "Started in <*> seconds (process running for <*>)");
        assert_eq!(masked("[InventoryClient#reserve] <--- HTTP/1.1 200 (52ms)"), "[InventoryClient#reserve] <--- <*> <*> (<*>ms)");
        assert_eq!(masked("trace 6f1c2a9b4d3e4f10 from 10.24.3.17, port 8080."), "trace <*> from <*>, port <*>.");
    }

    #[test]
    fn groups_and_merges() {
        let mut m = Miner::new();
        for s in ["Order 1 moved from PAID to SHIPPED by ravi", "Order 2 moved from CREATED to PAID by meera", "Order 3 moved from PAID to SHIPPED by ravi", "Tomcat started", "Cache hit for key order:7 ttl=20s"] {
            m.add(s.as_bytes());
        }
        m.skip();
        let (ids, blob) = m.finish();
        assert_eq!(ids, vec![0, 0, 0, 1, 2, u32::MAX]);
        assert_eq!(u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]), 3);
        assert_eq!(u32::from_le_bytes([blob[4], blob[5], blob[6], blob[7]]), 3);
    }
}
