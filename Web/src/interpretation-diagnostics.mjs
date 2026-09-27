// Console diagnostics contain controlled English text, never prompts or provider errors.
export function formatInterpretationDiagnostic(request, interpretation) {
  const warnings=interpretation?.warnings??[];
  const fallback=interpretation?.fallback;
  if(!fallback?.used&&!warnings.length) return '';
  const token=value=>String(value??'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);
  const codes=[...new Set(warnings.map(w=>token(w.code)).filter(Boolean))].slice(0,16);
  const fields=[...new Set((fallback?.replacements??[]).map(r=>token(r.path)||'request'))].slice(0,12);
  const message=`[PCG Interpretation] ${token(request.worldType)} seed=${request.seed}. `+
    (fallback?.used?'Interpretation was incomplete; generation will continue with supported settings and defaults. ':'Some requested details could not be applied exactly; generation will continue. ')+
    `Reason: ${token(fallback?.reason)||'REQUEST_ADJUSTED'}. Codes: ${codes.join(', ')||'none'}. Replaced fields: ${fields.join(', ')||'none'}.`;
  return message.slice(0,2048);
}
