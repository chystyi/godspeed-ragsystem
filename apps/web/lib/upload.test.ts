import { describe, expect, it } from "vitest";
import { checkUpload, MAX_UPLOAD_BYTES } from "./upload";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe("checkUpload", () => {
  it.each(["notes.txt", "Guide.PDF", "my.notes.txt"])("accepts %s", (name) => {
    expect(checkUpload(file(name))).toBeNull();
  });

  it.each(["report.docx", "image.png", "noextension", "notes.txt.exe"])("refuses %s by its name", (name) => {
    expect(checkUpload(file(name))).toMatch(/\.txt or \.pdf/);
  });

  it("refuses a file that is too large, and an empty one", () => {
    expect(checkUpload(file("big.txt", MAX_UPLOAD_BYTES + 1))).toMatch(/5 MB/);
    expect(checkUpload(file("big.txt", MAX_UPLOAD_BYTES))).toBeNull();
    expect(checkUpload(file("empty.txt", 0))).toMatch(/empty/i);
  });
});
