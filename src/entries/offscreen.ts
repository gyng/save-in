// Offscreen-document entry point for the rolldown bundle. The offscreen page
// (offscreen.html) originally loaded constants.js then offscreen.js; offscreen
// imports MESSAGE_TYPES from constants directly, so this entry just pulls it in.
// Emitted as bare scope-hoisted ESM, loaded as a classic script by the staged
// offscreen.html.

import "../shared/constants.ts";
import "../offscreen.ts";
