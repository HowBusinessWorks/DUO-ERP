import { describe, expect, it } from 'vitest';
import { isImageMime, isVideoMime, sniffMime } from './magic';

/**
 * Recunoasterea tipului dupa continut.
 *
 * Testul care conteaza cel mai mult e ultimul: HTML redenumit `.pdf`. Restul
 * verifica formatele pe care le acceptam; acela verifica de ce exista fisierul.
 */

const head = (...bytes: number[]): Uint8Array => {
  const buffer = new Uint8Array(64);
  buffer.set(bytes);
  return buffer;
};

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

describe('sniffMime', () => {
  it('recunoaste formatele acceptate', () => {
    expect(sniffMime(head(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMime(head(...ascii('GIF89a')))).toBe('image/gif');
    expect(sniffMime(head(...ascii('%PDF-1.7')))).toBe('application/pdf');
    expect(sniffMime(head(0x50, 0x4b, 0x03, 0x04))).toBe('application/zip');
  });

  it('desparte WebP de restul containerelor RIFF', () => {
    expect(sniffMime(head(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('image/webp');
    // Acelasi antet RIFF, alt continut: WAV nu e o poza si nu trece drept una.
    expect(sniffMime(head(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeUndefined();
  });

  it('desparte HEIC de MP4, desi amandoua incep cu ftyp', () => {
    expect(sniffMime(head(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBe('image/heic');
    expect(sniffMime(head(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')))).toBe('video/mp4');
  });

  it('respinge ce nu recunoaste — lista e ALBA, nu neagra', () => {
    expect(sniffMime(head(...ascii('<!doctype html>')))).toBeUndefined();
    expect(sniffMime(head(...ascii('#!/bin/sh')))).toBeUndefined();
    expect(sniffMime(head())).toBeUndefined();
  });

  it('nu se lasa pacalit de extensie: un HTML ramane necunoscut oricum l-ai numi', () => {
    // Scenariul real: `aviz.pdf` cu `Content-Type: application/pdf` declarat de
    // client, dar continut HTML cu `<script>`. Servit inapoi cu tipul declarat,
    // ar rula pe domeniul aplicatiei, cu sesiunea utilizatorului in el.
    const attack = head(...ascii('<html><script>fetch("/api/admin")'));
    expect(sniffMime(attack)).toBeUndefined();
  });
});

describe('clasificarea tipurilor', () => {
  it('stie ce e poza si ce e video', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isVideoMime('video/mp4')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
  });
});
