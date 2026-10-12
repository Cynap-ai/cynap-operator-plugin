/** JSON.parse silently accepts duplicate keys. Reject them before schema validation. */
export function parseFixtureJson(text) {
  const source = text.replace(/^\uFEFF/, '');
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  let i = 0;
  const walk = () => {
    const token = tokens[i++];
    if (token === '{') {
      const keys = new Set();
      while (tokens[i] !== '}') {
        const key = JSON.parse(tokens[i++]);
        if (keys.has(key)) throw new Error(`Duplicate fixture key: ${key}`);
        keys.add(key);
        if (tokens[i++] !== ':') throw new Error('Invalid fixture JSON');
        walk();
        if (tokens[i] !== ',') break;
        i += 1;
      }
      if (tokens[i++] !== '}') throw new Error('Invalid fixture JSON');
    } else if (token === '[') {
      while (tokens[i] !== ']') { walk(); if (tokens[i] !== ',') break; i += 1; }
      if (tokens[i++] !== ']') throw new Error('Invalid fixture JSON');
    } else if (token === undefined) throw new Error('Invalid fixture JSON');
  };
  walk();
  return JSON.parse(source);
}
