import { configureRoutingPorts } from "../routing/ports.ts";

/** The content bundle's composition root: content.ts is its entry, so this is
 * the one place allowed to configure the layers below it (see
 * scripts/check-import-cycles.js). Only the ports the page scan actually
 * reaches are supplied; the rest keep their library defaults, which is what a
 * content script can honour without a background.
 */
export const configureContentPorts = (): void => {
  configureRoutingPorts({
    // The automatic scan pre-matches candidates here and the background
    // re-matches them against the sending tab, so both have to read the same
    // title. The candidate cannot carry it — the candidate is the message
    // payload — and the library default answers undefined, which silently drops
    // every source a pagetitle: rule selects while the background and the route
    // debugger both say it matches. In a content script this page is the tab.
    //
    // A page with no <title> reports "", where the background's tab.title is
    // whatever the browser invented for the tab strip (usually the address).
    // This side is the honest one — "" is what the page declared — so a rule
    // written against a real title agrees either way, and only one written
    // against the invented string differs. It fails closed there: the scan
    // sends nothing rather than saving under a title the page never had.
    getCurrentTab: () => ({ title: document.title }),
  });
};
