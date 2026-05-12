import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectPaperBorderDrift } from "./imageValidation";

async function makePaperBorderImage() {
  const width = 480;
  const height = 300;
  const scene = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 44, g: 58, b: 76 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width,
            height: 34,
            channels: 3,
            background: { r: 216, g: 196, b: 154 },
          },
        })
          .png()
          .toBuffer(),
        top: 0,
        left: 0,
      },
      {
        input: await sharp({
          create: {
            width,
            height: 34,
            channels: 3,
            background: { r: 216, g: 196, b: 154 },
          },
        })
          .png()
          .toBuffer(),
        top: height - 34,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  return scene;
}

async function makeFullBleedComicImage() {
  return sharp({
    create: {
      width: 480,
      height: 300,
      channels: 3,
      background: { r: 92, g: 58, b: 112 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 260,
            height: 170,
            channels: 3,
            background: { r: 38, g: 91, b: 86 },
          },
        })
          .png()
          .toBuffer(),
        top: 64,
        left: 110,
      },
    ])
    .png()
    .toBuffer();
}

describe("detectPaperBorderDrift", () => {
  it("flags full-width pale paper strips at the top and bottom", async () => {
    const result = await detectPaperBorderDrift(await makePaperBorderImage());

    expect(result.hasPaperBorderDrift).toBe(true);
    expect(result.reason).toContain("paper border");
  });

  it("allows a full-bleed colored comic frame", async () => {
    const result = await detectPaperBorderDrift(await makeFullBleedComicImage());

    expect(result.hasPaperBorderDrift).toBe(false);
  });
});
