// content-script-extractor.js
// Runs in page context (injected by extension) and returns extracted data

(function () {
  function extractTicketIdFromHeader() {
    // Try the explicit automation id first
    const header = document.querySelector('[data-sap-automation-id="objectDetail-Header-Name"], [data-help-id="objectDetail-Header-Name"], #__text3740');
    if (header && header.textContent) {
      const m = header.textContent.match(/\b(\d{7})\b/);
      if (m) return m[1];
    }
    // Fallback: search the whole document text for any 7-digit number
    const fullText = document.body ? document.body.innerText : document.documentElement.innerText || '';
    const m2 = fullText.match(/\b(\d{7})\b/);
    return m2 ? m2[1] : null;
  }

  function isPhoneTitle(t) {
    return typeof t === 'string' && /^\+?\d/.test(t.trim());
  }

  function isNameTitle(t) {
    if (!t) return false;
    if (isPhoneTitle(t)) return false;
    // exclude long titles that are likely not person names
    return t.trim().length > 0 && t.trim().length <= 80;
  }

  function extractNamesAndPhones() {
    const anchors = Array.from(document.querySelectorAll('a.sapMLnk, a'));
    const phones = [];
    const names = [];

    anchors.forEach(a => {
      const title = a.getAttribute('title') || a.textContent || '';
      if (isPhoneTitle(title)) {
        phones.push(title.trim());
      } else if (isNameTitle(title)) {
        // avoid duplicates
        const nm = title.trim();
        if (nm && !names.includes(nm)) names.push(nm);
      }
    });

    // Heuristics:
    const primaryPhone = phones.length > 0 ? phones[0] : null;
    const secondaryPhone = phones.length > 1 ? phones[1] : null;
    const consumerName = names.length > 0 ? names[0] : null;
    // creator might be the last person-like name on the page
    const creatorName = names.length > 1 ? names[names.length - 1] : (names.length === 1 ? names[0] : null);

    return { primaryPhone, secondaryPhone, consumerName, creatorName, phonesFound: phones.length, namesFound: names.length};
  }

  const ticketId = extractTicketIdFromHeader();
  const namesPhones = extractNamesAndPhones();
  const pageUrl = window.location.href;
  const title = document.title || null;

  const result = {
    ticketId,
    consumerName: namesPhones.consumerName,
    primaryPhone: namesPhones.primaryPhone,
    secondaryPhone: namesPhones.secondaryPhone,
    creatorName: namesPhones.creatorName,
    pageUrl,
    title,
    timestamp: new Date().toISOString()
  };

  // Send result back to extension (via DOM -> content script bridge)
  window.postMessage({ type: 'TICKET_WATCHER_RESULT', payload: result }, '*');

})();
