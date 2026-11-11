import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionMenu,
  MenuAlign,
  MenuEvent,
  MenuPlacement,
  MenuTone,
  menuPosition,
  menuTransition,
  nextMenuIndex,
} from "../components/action-menu";
import { readComponent } from "./app-source";

const desktop = { width: 1440, height: 900 };
const phone = { width: 375, height: 812 };
const menu = { width: 240, height: 160 };
const trigger = (top: number, left: number) => ({
  top,
  left,
  width: 36,
  height: 36,
});

test("menu opens below the trigger, lined up with its end edge", () => {
  assert.deepEqual(menuPosition(trigger(100, 1000), menu, desktop), {
    top: 142,
    left: 796,
    placement: MenuPlacement.BELOW,
  });
  assert.equal(
    menuPosition(trigger(100, 1000), menu, desktop, MenuAlign.START).left,
    1000,
  );
});

test("menu flips above when there is no room below and more room above", () => {
  const near = menuPosition(trigger(800, 1000), menu, desktop);
  assert.equal(near.placement, MenuPlacement.ABOVE);
  assert.equal(near.top, 800 - 6 - 160);
  // Short on both sides: stay on the roomier side, kept inside the viewport.
  const tall = { width: 240, height: 700 };
  const middle = menuPosition(trigger(300, 1000), tall, desktop);
  assert.equal(middle.placement, MenuPlacement.BELOW);
  assert.equal(middle.top, 900 - 700 - 8);
});

test("menu stays inside a 375px viewport horizontally", () => {
  const atLeft = menuPosition(trigger(100, 16), menu, phone);
  assert.equal(atLeft.left, 8);
  const atRight = menuPosition(trigger(100, 340), menu, phone, MenuAlign.START);
  assert.equal(atRight.left, 375 - 240 - 8);
});

test("arrow keys move between enabled items and wrap", () => {
  const disabled = [false, true, false];
  assert.equal(nextMenuIndex("ArrowDown", 0, disabled), 2);
  assert.equal(nextMenuIndex("ArrowDown", 2, disabled), 0);
  assert.equal(nextMenuIndex("ArrowUp", 0, disabled), 2);
  assert.equal(nextMenuIndex("Home", 2, disabled), 0);
  assert.equal(nextMenuIndex("End", 0, disabled), 2);
  assert.equal(nextMenuIndex("ArrowDown", -1, disabled), 0);
  assert.equal(nextMenuIndex("Enter", 0, disabled), null);
  assert.equal(nextMenuIndex("ArrowDown", 0, [true, true]), null);
});

test("menu opens and closes, returning focus to the trigger on Escape and select", () => {
  assert.deepEqual(menuTransition(false, MenuEvent.TOGGLE), {
    open: true,
    restoreFocus: false,
  });
  assert.deepEqual(menuTransition(true, MenuEvent.TOGGLE), {
    open: false,
    restoreFocus: true,
  });
  for (const event of [MenuEvent.ESCAPE, MenuEvent.SELECT, MenuEvent.TAB])
    assert.deepEqual(menuTransition(true, event), {
      open: false,
      restoreFocus: true,
    });
  // Outside clicks leave focus where the person sent it.
  assert.deepEqual(menuTransition(true, MenuEvent.OUTSIDE), {
    open: false,
    restoreFocus: false,
  });
  assert.deepEqual(menuTransition(false, MenuEvent.ESCAPE), {
    open: false,
    restoreFocus: false,
  });
});

test("closed trigger announces a menu and renders no list in place", () => {
  const html = renderToStaticMarkup(
    createElement(ActionMenu, {
      label: "Agreement actions",
      items: [
        { id: "a", label: "View payouts", onSelect: () => {} },
        {
          id: "b",
          label: "Remove",
          onSelect: () => {},
          tone: MenuTone.DANGER,
        },
      ],
    }),
  );
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Agreement actions"/);
  assert.doesNotMatch(html, /role="menu"/);
});

test("agreement header uses the shared menu, not a details popover", () => {
  const header = readComponent("agreement-workspace.tsx");
  assert.match(header, /<ActionMenu[\s\S]*label="Agreement actions"/);
  assert.doesNotMatch(header, /ag-menu|<details/);
});
