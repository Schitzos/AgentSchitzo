import fs from "fs";
import path from "path";
import { clearUploads } from "../cron/clear-uploads.ts";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

describe("clearUploads", () => {
  beforeEach(() => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, "a.txt"), "x");
    fs.writeFileSync(path.join(UPLOADS_DIR, "b.jpg"), "y");
  });

  afterEach(() => {
    fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  it("removes all files inside uploads/", () => {
    clearUploads();
    expect(fs.readdirSync(UPLOADS_DIR)).toHaveLength(0);
  });

  it("does nothing if uploads/ does not exist", () => {
    fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
    expect(() => clearUploads()).not.toThrow();
  });
});
