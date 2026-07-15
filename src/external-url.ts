const ENCODED_CONTROL_CHARACTER_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const ABSOLUTE_HTTP_URL_PATTERN = /^(https?):\/\/(.*)$/i;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Normalize an optional URL while preserving the distinction between blank and invalid. */
export function normalizeOptionalHttpUrl(value: string): string | null | undefined {
  if (
    typeof value === 'string'
    && !hasActualControlCharacter(value)
    && value.trim() === ''
  ) {
    return undefined;
  }

  return normalizeHttpUrl(value);
}

/**
 * Return a canonical absolute HTTP(S) URL, or `null` when the value is not safe
 * to hand to the host browser. This intentionally uses only ES string/number
 * primitives because Figma's main sandbox does not provide browser URL APIs.
 */
export function normalizeHttpUrl(value: string): string | null {
  if (
    typeof value !== 'string'
    || hasActualControlCharacter(value)
    || ENCODED_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }

  const candidate = value.trim();

  if (
    candidate === ''
    || /\s/.test(candidate)
    || candidate.includes('\\')
  ) {
    return null;
  }

  const match = ABSOLUTE_HTTP_URL_PATTERN.exec(candidate);
  if (!match) {
    return null;
  }

  const scheme = match[1].toLowerCase();
  const remainder = match[2];
  const authorityEnd = remainder.search(/[/?#]/);
  const end = authorityEnd === -1 ? remainder.length : authorityEnd;
  const authority = normalizeAuthority(remainder.slice(0, end), scheme);

  if (!authority) {
    return null;
  }

  const suffix = remainder.slice(end);
  const pathQueryHash = suffix === ''
    ? '/'
    : suffix.startsWith('/')
    ? suffix
    : `/${suffix}`;

  return `${scheme}://${authority}${pathQueryHash}`;
}

function normalizeAuthority(authority: string, scheme: string): string | null {
  if (authority === '' || authority.includes('@')) {
    return null;
  }

  let host: string;
  let normalizedHost: string;
  let port: string | undefined;

  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');

    if (closingBracket <= 1) {
      return null;
    }

    host = authority.slice(1, closingBracket);
    const afterHost = authority.slice(closingBracket + 1);

    if (afterHost !== '') {
      if (!afterHost.startsWith(':') || afterHost.length === 1) {
        return null;
      }

      port = afterHost.slice(1);
    }

    if (!isValidIpv6(host)) {
      return null;
    }

    normalizedHost = `[${host.toLowerCase()}]`;
  } else {
    if (authority.includes('[') || authority.includes(']')) {
      return null;
    }

    const colon = authority.indexOf(':');

    if (colon !== -1) {
      if (colon !== authority.lastIndexOf(':')) {
        return null;
      }

      host = authority.slice(0, colon);
      port = authority.slice(colon + 1);
      if (port === '') {
        return null;
      }
    } else {
      host = authority;
    }

    if (!isValidDnsOrIpv4(host)) {
      return null;
    }

    normalizedHost = host.toLowerCase();
  }

  if (port === undefined) {
    return normalizedHost;
  }

  if (!/^\d+$/.test(port)) {
    return null;
  }

  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65_535) {
    return null;
  }

  if ((scheme === 'http' && portNumber === 80) || (scheme === 'https' && portNumber === 443)) {
    return normalizedHost;
  }

  return `${normalizedHost}:${portNumber}`;
}

function isValidDnsOrIpv4(host: string): boolean {
  if (host === '' || !/^[a-z0-9.-]+$/i.test(host)) {
    return false;
  }

  if (/^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(host)) {
    return isValidIpv4(host);
  }

  const dnsName = host.endsWith('.') ? host.slice(0, -1) : host;
  if (dnsName === '' || dnsName.length > 253) {
    return false;
  }

  const labels = dnsName.split('.');
  return labels.every((label) => DNS_LABEL_PATTERN.test(label))
    && !/^\d+$/.test(labels[labels.length - 1]);
}

function isValidIpv4(host: string): boolean {
  const octets = host.split('.');

  return octets.length === 4 && octets.every((octet) => {
    return /^\d+$/.test(octet)
      && (octet === '0' || !octet.startsWith('0'))
      && Number(octet) <= 255;
  });
}

function isValidIpv6(host: string): boolean {
  if (host === '' || !/^[0-9a-f:.]+$/i.test(host)) {
    return false;
  }

  const compressionIndex = host.indexOf('::');
  const hasCompression = compressionIndex !== -1;
  if (hasCompression && compressionIndex !== host.lastIndexOf('::')) {
    return false;
  }

  const parts = hasCompression
    ? [
        ...splitIpv6Side(host.slice(0, compressionIndex)),
        ...splitIpv6Side(host.slice(compressionIndex + 2)),
      ]
    : host.split(':');
  let groupCount = 0;

  for (const [index, part] of parts.entries()) {
    if (part.includes('.')) {
      if (index !== parts.length - 1 || !isValidIpv4(part)) {
        return false;
      }

      groupCount += 2;
    } else {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) {
        return false;
      }

      groupCount += 1;
    }
  }

  return hasCompression ? groupCount < 8 : groupCount === 8;
}

function splitIpv6Side(value: string): string[] {
  return value === '' ? [] : value.split(':');
}

function hasActualControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode <= 31 || characterCode === 127) {
      return true;
    }
  }

  return false;
}
