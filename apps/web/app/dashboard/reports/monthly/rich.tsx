/**
 * Put nodes (a <Money>, a link) into a translated sentence: `template` keeps
 * `{name}` placeholders (pass `'{name}'` as the value to `t()`), and each one
 * is replaced by `slots[name]`. Unknown placeholders stay as text.
 */
export function rich(template: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/(\{[a-zA-Z]+\})/).map((part, i) => {
    const name = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
    return name && name in slots ? <span key={i}>{slots[name]}</span> : part;
  });
}
