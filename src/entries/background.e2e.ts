// Browser-test entry: production startup plus one same-extension command used
// to seed an internal pipeline path. Everything else uses production messages.
import "./background.ts";
import { registerBackgroundE2ECommand } from "../background/e2e-command.ts";

registerBackgroundE2ECommand();
