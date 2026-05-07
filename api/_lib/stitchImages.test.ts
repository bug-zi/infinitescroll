import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { copyPreviousOverlapIntoNewImage, createOutpaintCanvas, extractRightOverlapByWidth } from "./stitchImages";

async function solidPng(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("server image stitching", () => {
  it("copies the previous right edge into the generated image left overlap", async () => {
    const previous = await solidPng(1024, 768, { r: 240, g: 40, b: 10 });
    const generated = await solidPng(1536, 1024, { r: 20, g: 90, b: 220 });

    const stitched = await copyPreviousOverlapIntoNewImage(generated, previous, {
      overlapWidth: 128,
      height: 768,
      overlapRatio: 0.125,
    });

    const leftPixel = await sharp(stitched).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const rightPixel = await sharp(stitched).extract({ left: 129, top: 0, width: 1, height: 1 }).raw().toBuffer();

    expect(Array.from(leftPixel)).toEqual([240, 40, 10, 255]);
    expect(Array.from(rightPixel)).toEqual([20, 90, 220, 255]);
  });

  it("makes the displayed overlap region pixel-identical to the previous right edge", async () => {
    const previous = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 256,
              height: 768,
              channels: 3,
              background: { r: 200, g: 150, b: 90 },
            },
          })
            .png()
            .toBuffer(),
          left: 768,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const generated = await solidPng(1152, 768, { r: 20, g: 90, b: 220 });

    const stitched = await copyPreviousOverlapIntoNewImage(generated, previous, {
      overlapWidth: 230,
      height: 768,
      overlapRatio: 0.25,
    });

    const previousRight = await sharp(previous).extract({ left: 768, top: 0, width: 256, height: 768 }).resize(230, 768).raw().toBuffer();
    const newLeft = await sharp(stitched).extract({ left: 0, top: 0, width: 230, height: 768 }).raw().toBuffer();

    expect(Buffer.compare(previousRight, newLeft)).toBe(0);
  });

  it("copies the exact previous displayed overlap width without ratio resampling drift", async () => {
    const width = 1024;
    const height = 768;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        raw[offset] = x % 256;
        raw[offset + 1] = (x * 3) % 256;
        raw[offset + 2] = (x * 7) % 256;
      }
    }
    const previous = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
    const generated = await solidPng(1152, 768, { r: 20, g: 90, b: 220 });

    const stitched = await copyPreviousOverlapIntoNewImage(generated, previous, {
      overlapWidth: 230,
      height,
      overlapRatio: 0.25,
    });

    const previousDisplayedEdge = await sharp(previous).extract({ left: width - 230, top: 0, width: 230, height }).removeAlpha().raw().toBuffer();
    const newLeft = await sharp(stitched).extract({ left: 0, top: 0, width: 230, height }).removeAlpha().raw().toBuffer();

    expect(Buffer.compare(previousDisplayedEdge, newLeft)).toBe(0);
  });

  it("can stitch to the larger saved panorama segment size", async () => {
    const previous = await solidPng(1536, 1152, { r: 210, g: 120, b: 80 });
    const generated = await solidPng(1536, 1024, { r: 20, g: 90, b: 220 });

    const stitched = await copyPreviousOverlapIntoNewImage(generated, previous, {
      width: 1920,
      overlapWidth: 384,
      height: 1152,
      overlapRatio: 0.25,
    });

    const metadata = await sharp(stitched).metadata();
    const newLeft = await sharp(stitched).extract({ left: 0, top: 0, width: 384, height: 1152 }).removeAlpha().raw().toBuffer();
    const previousRight = await sharp(previous).extract({ left: 1536 - 384, top: 0, width: 384, height: 1152 }).removeAlpha().raw().toBuffer();

    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1152);
    expect(Buffer.compare(previousRight, newLeft)).toBe(0);
  });

  it("does not crop the outpaint result when resizing it to the saved segment size", async () => {
    const previous = await solidPng(1536, 1152, { r: 210, g: 120, b: 80 });
    const generated = await sharp({
      create: {
        width: 1536,
        height: 1024,
        channels: 3,
        background: { r: 30, g: 130, b: 70 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 1536,
              height: 40,
              channels: 3,
              background: { r: 240, g: 20, b: 20 },
            },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    const stitched = await copyPreviousOverlapIntoNewImage(generated, previous, {
      width: 1920,
      overlapWidth: 384,
      height: 1152,
      overlapRatio: 0.25,
    });

    const firstNewContentPixel = await sharp(stitched)
      .extract({ left: 400, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect(Array.from(firstNewContentPixel)).toEqual([240, 20, 20]);
  });

  it("uses the same canonical previous edge for the outpaint canvas and final overlap copy", async () => {
    const width = 1024;
    const height = 768;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        raw[offset] = x % 256;
        raw[offset + 1] = (x * 5 + y) % 256;
        raw[offset + 2] = (x * 11 + y * 3) % 256;
      }
    }
    const previous = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
    const finalOverlapWidth = 230;
    const canvasOverlapWidth = 307;

    const canvas = await createOutpaintCanvas(previous, 1536, 1024, canvasOverlapWidth, finalOverlapWidth, height);

    const canonicalPreviousEdge = await extractRightOverlapByWidth(previous, finalOverlapWidth, height);
    const expectedCanvasEdge = await sharp(canonicalPreviousEdge).resize(canvasOverlapWidth, 1024, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const actualCanvasEdge = await sharp(canvas)
      .extract({ left: 0, top: 0, width: canvasOverlapWidth, height: 1024 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect(Buffer.compare(actualCanvasEdge, expectedCanvasEdge)).toBe(0);
  });
});
