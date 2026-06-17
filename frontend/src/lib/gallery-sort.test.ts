// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";

import { sortGalleries, flattenTree, galleryPath } from "./gallery-sort";
import type { GalleryResponse } from "./types";

function g(partial: Partial<GalleryResponse> & { id: string }): GalleryResponse {
  return {
    name: partial.id,
    image_count: 0,
    created_at: "2024-01-01T00:00:00Z",
    children: [],
    ...partial,
  } as GalleryResponse;
}

describe("sortGalleries", () => {
  it("sorts by name A→Z and reverses for desc", () => {
    const list = [g({ id: "c", name: "Charlie" }), g({ id: "a", name: "Alpha" }), g({ id: "b", name: "Bravo" })];
    expect(sortGalleries(list, "name", "asc").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sortGalleries(list, "name", "desc").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts by photo count", () => {
    const list = [g({ id: "x", image_count: 5 }), g({ id: "y", image_count: 1 }), g({ id: "z", image_count: 9 })];
    expect(sortGalleries(list, "photos", "asc").map((x) => x.id)).toEqual(["y", "x", "z"]);
    expect(sortGalleries(list, "photos", "desc").map((x) => x.id)).toEqual(["z", "x", "y"]);
  });

  it("sorts by created_at, newest-first when desc", () => {
    const list = [
      g({ id: "old", created_at: "2023-01-01T00:00:00Z" }),
      g({ id: "new", created_at: "2025-01-01T00:00:00Z" }),
    ];
    expect(sortGalleries(list, "created", "desc").map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("does not mutate the input array", () => {
    const list = [g({ id: "b" }), g({ id: "a" })];
    sortGalleries(list, "name", "asc");
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("flattenTree", () => {
  it("depth-first flattens with depth tags", () => {
    const tree = [
      g({ id: "root", children: [g({ id: "child", children: [g({ id: "grandchild" })] })] }),
      g({ id: "root2" }),
    ];
    expect(flattenTree(tree).map((e) => [e.g.id, e.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["root2", 0],
    ]);
  });
});

describe("galleryPath", () => {
  const tree = [g({ id: "root", children: [g({ id: "child", children: [g({ id: "leaf" })] })] })];

  it("returns the path from root to the target inclusive", () => {
    expect(galleryPath(tree, "leaf").map((x) => x.id)).toEqual(["root", "child", "leaf"]);
  });

  it("returns [] for an unknown id and for null", () => {
    expect(galleryPath(tree, "missing")).toEqual([]);
    expect(galleryPath(tree, null)).toEqual([]);
  });
});
