// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";

// The autosave hooks rely on React Query's mutation `scope` to send PATCHes one at a time, in call
// order, while the optimistic `onMutate` still fires immediately. Pin that library behaviour.
describe("autosave mutation scope", () => {
  it("runs same-scope mutations serially but applies onMutate right away", async () => {
    const qc = new QueryClient();
    const log: string[] = [];
    const gates: Array<() => void> = [];
    const make = () =>
      new MutationObserver<string, Error, string>(qc, {
        scope: { id: "gallery-settings:g1" },
        onMutate: (v) => { log.push(`optimistic ${v}`); },
        mutationFn: (v) =>
          new Promise<string>((resolve) => {
            log.push(`start ${v}`);
            gates.push(() => { log.push(`done ${v}`); resolve(v); });
          }),
      });

    const first = make().mutate("on");
    const second = make().mutate("off");
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["optimistic on", "optimistic off", "start on"]);

    gates[0]();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(log.slice(3)).toEqual(["done on", "start off"]);
    gates[1]();
    await second;
  });
});
