import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnswerSource,
  type AgreementAnswers,
  type PersonAnswer,
} from "../lib/rules-answers";
import {
  PeopleStep,
  peopleEmailErrors,
  sharePercent,
  validatePeopleEmails,
} from "../components/people-step";

const SELF_EMAIL = "maya@okafor.studio";

const person = (
  key: string,
  name: string,
  basisPoints: number,
  email?: string,
  isSelf = false,
): PersonAnswer => ({ key, name, basisPoints, email, isSelf });

const answersWith = (people: PersonAnswer[]): AgreementAnswers => ({
  name: { value: "Midnight Sessions", source: AnswerSource.DOCUMENT },
  people: { value: people, source: AnswerSource.DOCUMENT, clause: "§ 4.2" },
  questions: [],
});

const maya = person("maya", "Maya Okafor", 5000, SELF_EMAIL, true);

test("a complete roster is valid and the organizer needs no email field", () => {
  const answers = answersWith([
    maya,
    person("jordan", "Jordan Reyes", 3000, "jordan@reyes.fm"),
    person("riley", "Riley Chen", 2000, " Riley@Chen.audio "),
  ]);
  assert.equal(validatePeopleEmails(answers), undefined);
  assert.equal(
    validatePeopleEmails(
      answersWith([{ ...maya, email: undefined }]),
      SELF_EMAIL,
    ),
    undefined,
  );
});

test("validatePeopleEmails returns the first row problem in order", () => {
  assert.equal(
    validatePeopleEmails(answersWith([maya, person("j", "Jordan", 5000)])),
    "Jordan: Enter an email.",
  );
  assert.equal(
    validatePeopleEmails(
      answersWith([maya, person("j", "Jordan", 5000, "not-an-email")]),
    ),
    "Jordan: Enter a valid email.",
  );
  assert.equal(
    validatePeopleEmails(answersWith([maya, person("j", " ", 5000, "j@x.co")])),
    "Enter a name for the person with 50%.",
  );
  assert.match(
    validatePeopleEmails(
      answersWith([maya, person("j", "Me again", 5000, "MAYA@okafor.studio")]),
    ) ?? "",
    /That's your email/,
  );
  assert.match(
    validatePeopleEmails(
      answersWith([
        { ...maya, email: undefined },
        person("j", "Jordan", 5000, "maya@okafor.studio"),
      ]),
      SELF_EMAIL,
    ) ?? "",
    /That's your email/,
  );
});

test("duplicate emails are case-insensitive and only the later row is flagged", () => {
  const errors = peopleEmailErrors(
    answersWith([
      maya,
      person("a", "Jordan", 2500, "jordan@reyes.fm"),
      person("b", "Jordan two", 2500, "JORDAN@reyes.fm"),
    ]),
  );
  assert.equal(errors.a, undefined);
  assert.equal(errors.b?.email, "This email is already added.");
});

test("someone at 0% must be removed, not emailed", () => {
  const answers = answersWith([
    { ...maya, basisPoints: 10000 },
    person("sam", "Sam Lee", 0),
  ]);
  assert.equal(
    validatePeopleEmails(answers),
    "Remove Sam Lee. They're not in the split.",
  );
});

test("shares read as percents", () => {
  assert.equal(sharePercent(5000), "50%");
  assert.equal(sharePercent(3333), "33.33%");
  assert.equal(sharePercent(10000), "100%");
});

test("renders the headline, the organizer as You, shares, emails and Not in the split", () => {
  const html = renderToStaticMarkup(
    createElement(PeopleStep, {
      answers: answersWith([
        maya,
        person("jordan", "Jordan Reyes", 5000, "jordan@reyes.fm"),
        person("sam", "Sam Lee", 0),
      ]),
      onChange: () => {},
    }),
  );
  assert.match(html, /Who should we send this to\?/);
  assert.match(html, /Add their emails so they can approve\./);
  assert.match(html, />You</);
  assert.match(html, />maya@okafor\.studio</);
  assert.match(html, />50%</);
  assert.match(html, /value="jordan@reyes\.fm"/);
  assert.match(html, /value="Jordan Reyes"/);
  assert.match(html, /Not in the split/);
  assert.match(html, /aria-label="Remove Sam Lee"/);
  assert.equal((html.match(/type="email"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Remove /g) ?? []).length, 1);
  assert.doesNotMatch(html, /Enter an email/);
  assert.doesNotMatch(html, /Role|Owner/);
});

test("errors appear once the wizard asks for them", () => {
  const html = renderToStaticMarkup(
    createElement(PeopleStep, {
      answers: answersWith([maya, person("j", "", 5000, "bad")]),
      onChange: () => {},
      showErrors: true,
    }),
  );
  assert.match(html, /Enter a name\./);
  assert.match(html, /Enter a valid email\./);
  assert.match(html, /aria-invalid="true"/);
});
