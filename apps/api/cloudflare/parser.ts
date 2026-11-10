import { Container } from "@cloudflare/containers";
/** Stateless private parser: no secrets, ledger volume, public ingress or egress. */
export class FairshareDocumentParser extends Container {
  defaultPort = 8080;
  sleepAfter = "1m";
  enableInternet = false;
}
