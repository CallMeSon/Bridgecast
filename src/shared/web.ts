/** Shown when a typed web address is refused. */
export const WEB_URL_ERROR = 'Enter a web address that starts with https://.'
/** Shown next to an accepted http address. */
export const WEB_HTTP_WARNING = 'This page is not secure (http). Use https if the site supports it.'

/**
 * Turns what the operator typed or pasted into a web deck URL. No scheme gets
 * `https://`; `http:` is accepted with a warning; every other scheme, spaces in
 * the host and empty input are refused.
 */
export function sanitizeWebUrl(
  input: string
): { url: string; warning?: string } | { error: string } {
  const text = input.trim()
  if (text === '') return { error: WEB_URL_ERROR }
  // A scheme is `letters:` followed by `//`, or a known no-slash scheme; a bare
  // `host:port` is not one.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)
  const hasScheme =
    !!scheme &&
    (text.slice(scheme[0].length).startsWith('//') || !/^\d/.test(text.slice(scheme[0].length)))
  const withScheme = hasScheme ? text : `https://${text}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { error: WEB_URL_ERROR }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: WEB_URL_ERROR }
  if (parsed.hostname === '' || /\s/.test(text.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0])) {
    return { error: WEB_URL_ERROR }
  }
  if (parsed.protocol === 'http:') return { url: parsed.href, warning: WEB_HTTP_WARNING }
  return { url: parsed.href }
}

/** The hostname of a web deck URL without a leading `www.`; the input itself when it is not a URL. */
export function webDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}
