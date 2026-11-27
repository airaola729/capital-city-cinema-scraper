// Diagnostic script for the manual "Probe sources" workflow. It does nothing by default.
// To investigate a source, replace this file on a branch with a short script (for example: open the page in
// Chromium, log its XHR/fetch responses and a few selector counts), push the branch and run the workflow on it.
// Never use it to get past a CAPTCHA or bot check.
console.log('No probe defined. Edit scripts/probe.mjs on a branch to add one.');
