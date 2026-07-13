// Browser-test entry: production startup plus same-extension commands used to
// drive internal browser boundaries. Store builds contain no test control.
import "./background.ts";
import { registerBackgroundE2ECommand } from "../background/e2e-command.ts";

registerBackgroundE2ECommand();
