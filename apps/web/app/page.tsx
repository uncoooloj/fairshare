import type { Metadata } from "next";
import styles from "./landing.module.css";
import { LogoMark } from "../components/logo-mark";

export const metadata: Metadata = {
  title: "Fairshare · The money follows the agreement",
  description:
    "Upload an agreement, approve the rules together, and follow every revenue split and payout in one place.",
};

export default function Home() {
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#how-it-works">
        Skip to how Fairshare works
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="Fairshare home">
          <LogoMark /> Fairshare
        </a>
        <nav aria-label="Public navigation">
          <a href="#how-it-works">How it works</a>
          <a href="/login">
            Log in <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main>
        <section className={styles.hero} aria-labelledby="headline">
          <p className={styles.eyebrow}>
            Your agreement. Everyone’s fair share.
          </p>
          <h1 id="headline">
            The money follows
            <br />
            the agreement.
          </h1>
          <p className={styles.intro}>
            Turn your signed agreement into clear revenue splits.
            <br className={styles.desktopBreak} /> Agree on the rules together.
            See where every payment goes.
          </p>
          <a className={styles.primary} href="/login">
            Get started <span aria-hidden="true">→</span>
          </a>
          <p className={styles.note}>
            Have an account? <a href="/login">Open your workspace</a>
          </p>
        </section>
        <section
          id="how-it-works"
          className={styles.how}
          aria-labelledby="how-title"
        >
          <h2 id="how-title">Here’s how Fairshare works</h2>
          <div className={styles.steps}>
            <article className={styles.step}>
              <div className={styles.visual} aria-hidden="true">
                <div className={styles.document}>
                  <span>AGREEMENT</span>
                  <i />
                  <i />
                  <i />
                  <div className={styles.clause}>Revenue sharing terms</div>
                  <i />
                </div>
              </div>
              <p className={styles.number}>01</p>
              <h3>Upload agreement</h3>
              <p>
                Add the signed PDF or Word file. We read the revenue clauses.
              </p>
            </article>
            <article className={styles.step}>
              <div className={styles.visual} aria-hidden="true">
                <div className={styles.approval}>
                  <div className={styles.people}>
                    <span>MO</span>
                    <span>JR</span>
                    <span>RC</span>
                  </div>
                  <p>✓ &nbsp;3 of 3 approved</p>
                </div>
              </div>
              <p className={styles.number}>02</p>
              <h3>Everyone approves</h3>
              <p>
                Each person checks the rules against the clauses and approves.
              </p>
            </article>
            <article className={styles.step}>
              <div className={styles.visual} aria-hidden="true">
                <div className={styles.split}>
                  <strong>$1,000</strong>
                  <span className={styles.connector}>↓</span>
                  <div>
                    <span>
                      MO<b>$500</b>
                    </span>
                    <span>
                      JR<b>$300</b>
                    </span>
                    <span>
                      RC<b>$200</b>
                    </span>
                  </div>
                  <small>Illustrative split</small>
                </div>
              </div>
              <p className={styles.number}>03</p>
              <h3>Payments follow the rules</h3>
              <p>
                Every confirmed payment is divided by the approved rules. Track
                allocations and payouts in one place.
              </p>
            </article>
          </div>
          <p className={styles.qualifier}>
            People approve the rules, not the AI. Payouts depend on recipient
            setup and payment-provider confirmation.
          </p>
        </section>
        <section className={styles.closing} aria-label="Get started">
          <div>
            <h2>Start with the agreement.</h2>
            <p>Keep the rules, the people and the payments together.</p>
          </div>
          <a className={styles.primary} href="/login">
            Get started <span aria-hidden="true">→</span>
          </a>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Fairshare</span>
        <span>Built with PayPal Sandbox · No live money</span>
        <a href="/login">Log in</a>
      </footer>
    </div>
  );
}
