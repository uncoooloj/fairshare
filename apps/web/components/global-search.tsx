"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Agreement } from "../lib/model";
import { agreementIdentityKey } from "../lib/agreement-identity";
import { toneInRoster } from "../lib/person";
import { Avatar, AvatarSize } from "./person";

enum ResultKind {
  AGREEMENT = "agreement",
  PERSON = "person",
}

interface SearchResult {
  key: string;
  kind: ResultKind;
  label: string;
  detail: string;
  agreement: Agreement;
  tone?: number;
}

const RESULT_LIMIT = 8;

/** Top-bar search: opens agreements by name or by a person on them. Uses the same open path as the list. */
export function GlobalSearch({
  agreements,
  disabled = false,
  onOpen,
}: {
  agreements: Agreement[];
  disabled?: boolean;
  onOpen: (agreement: Agreement) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [shortcut, setShortcut] = useState("⌘K");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("Ctrl K");
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const term = query.trim().toLowerCase();
    const matches: SearchResult[] = [];
    for (const agreement of agreements) {
      const key = agreementIdentityKey(agreement);
      const people = agreement.value.members;
      if (!term || agreement.value.name.toLowerCase().includes(term))
        matches.push({
          key: `a:${key}`,
          kind: ResultKind.AGREEMENT,
          label: agreement.value.name,
          detail: `${people.length} ${people.length === 1 ? "person" : "people"}`,
          agreement,
        });
      if (!term) continue;
      for (const member of people)
        if (member.displayName.toLowerCase().includes(term))
          matches.push({
            key: `p:${key}:${member.userId}`,
            kind: ResultKind.PERSON,
            label: member.displayName,
            detail: `In ${agreement.value.name}`,
            agreement,
            tone: toneInRoster(member.userId, people),
          });
    }
    return matches.slice(0, RESULT_LIMIT);
  }, [agreements, query]);

  function choose(result: SearchResult | undefined) {
    if (!result) return;
    setOpen(false);
    setQuery("");
    input.current?.blur();
    onOpen(result.agreement);
  }

  const showList = open && agreements.length > 0;
  return (
    <div className="global-search" ref={root}>
      <svg
        className="global-search-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search agreements and people"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && results[active] ? `${listId}-${active}` : undefined
        }
        placeholder="Search agreements and people"
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((value) => Math.min(value + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(results[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      <kbd className="global-search-kbd" aria-hidden="true">
        {shortcut}
      </kbd>
      {showList && (
        <ul className="global-search-results" id={listId} role="listbox">
          {results.length ? (
            results.map((result, index) => (
              <li
                key={result.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? "is-active" : undefined}
                onPointerEnter={() => setActive(index)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(result);
                }}
              >
                {result.kind === ResultKind.PERSON ? (
                  <Avatar
                    name={result.label}
                    tone={result.tone ?? 0}
                    size={AvatarSize.SMALL}
                    label={false}
                  />
                ) : (
                  <span className="global-search-doc" aria-hidden="true">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                    >
                      <path d="M6 3h8l4 4v14H6zM14 3v5h4" />
                    </svg>
                  </span>
                )}
                <span className="global-search-text">
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </span>
              </li>
            ))
          ) : (
            <li className="global-search-empty" role="presentation">
              No agreements or people match “{query.trim()}”.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
