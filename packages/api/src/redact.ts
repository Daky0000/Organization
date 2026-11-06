export function redactSensitive(value: unknown,depth=0): unknown {
  if (depth>8) return '[redacted nested data]';
  if (typeof value==='string') return value.replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g,'[redacted key]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi,'$1[redacted]');
  if (value instanceof Error) {
    const safe=new Error(String(redactSensitive(value.message,depth+1)));
    safe.name=value.name;safe.stack=String(redactSensitive(value.stack || '',depth+1));return safe;
  }
  if (Array.isArray(value)) return value.map(item=>redactSensitive(item,depth+1));
  if (value && typeof value==='object') {
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(secret|password|authorization|cookie|token|api.?key)/i.test(key) ? '[redacted]' : redactSensitive(item,depth+1)]));
  }
  return value;
}
