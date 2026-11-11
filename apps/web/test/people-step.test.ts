import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InviteeRole } from "../lib/agreement-invitations";
import {
  PeopleStep,
  peopleErrors,
  validatePeople,
  type PersonDraft,
} from "../components/people-step";

const owner = { name: "Maya Okafor", email: "maya@okafor.studio" };
const person = (key: string, name: string, email: string): PersonDraft => ({
  key,
  name,
  email,
  role: InviteeRole.COLLABORATOR,
});

test("an empty roster and a well-formed roster are both valid", () => {
  assert.equal(validatePeople([], owner.email), undefined);
  assert.equal(
    validatePeople(
      [
        person("a", "Jordan Reyes", "jordan@reyes.fm"),
        person("b", "Riley Chen", " Riley@Chen.audio "),
      ],
      owner.email,
    ),
    undefined,
  );
});

test("validatePeople returns the first row problem in order", () => {
  assert.equal(
    validatePeople([person("a", " ", "x@y.co")]),
    "Person 2: Enter a name.",
  );
  assert.equal(
    validatePeople([person("a", "Jordan", "not-an-email")]),
    "Jordan: Enter a valid email.",
  );
  assert.equal(
    validatePeople([person("a", "Jordan", "")]),
    "Jordan: Enter an email.",
  );
  assert.match(
    validatePeople(
      [person("a", "Me again", "MAYA@okafor.studio")],
      owner.email,
    ) ?? "",
    /already the owner/,
  );
});

test("duplicate emails are case-insensitive and only the later row is flagged", () => {
  const errors = peopleErrors([
    person("a", "Jordan", "jordan@reyes.fm"),
    person("b", "Jordan two", "JORDAN@reyes.fm"),
  ]);
  assert.equal(errors.a, undefined);
  assert.equal(errors.b?.email, "This email is already added.");
});

test("renders the fixed owner row, collaborator rows and the callout", () => {
  const html = renderToStaticMarkup(
    createElement(PeopleStep, {
      owner,
      people: [
        person("a", "Jordan Reyes", "jordan@reyes.fm"),
        person("b", "", ""),
      ],
      onChange: () => {},
    }),
  );
  assert.match(html, /Maya Okafor/);
  assert.match(html, /\(you\)/);
  assert.match(html, />Owner</);
  assert.match(html, /aria-label="Remove Jordan Reyes"/);
  assert.match(html, /aria-label="Remove person"/);
  assert.equal((html.match(/aria-label="Remove /g) ?? []).length, 2);
  assert.match(html, /<option value="COLLABORATOR"[^>]*>Collaborator</);
  assert.match(html, /Add person/);
  assert.match(html, /invite link once the agreement is created/);
  assert.doesNotMatch(html, /Just you for now/);
  assert.doesNotMatch(html, /Enter a name/);
});

test("errors appear once the wizard asks for them, and an empty roster shows a hint", () => {
  const withErrors = renderToStaticMarkup(
    createElement(PeopleStep, {
      owner,
      people: [person("a", "", "bad")],
      onChange: () => {},
      showErrors: true,
    }),
  );
  assert.match(withErrors, /Enter a name\./);
  assert.match(withErrors, /Enter a valid email\./);
  assert.match(withErrors, /aria-invalid="true"/);

  const empty = renderToStaticMarkup(
    createElement(PeopleStep, { owner, people: [], onChange: () => {} }),
  );
  assert.match(empty, /Just you for now/);
});
