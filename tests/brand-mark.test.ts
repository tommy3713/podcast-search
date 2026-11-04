import { readFileSync } from 'node:fs';
import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from '@/components/BrandMark';

// Each shape's tag and geometry, in order; colours are left out (the header recolours them by theme)
const GEOMETRY = ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'd', 'stroke-width', 'stroke-linecap'];
const TAGS = ['rect', 'circle', 'path'];
const describeShape = (tag: string, attrs: [string, string][]) =>
  `${tag} ${attrs
    .filter(([name]) => GEOMETRY.includes(name))
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join(' ')}`;

function svgShapes(svg: string): string[] {
  return [...svg.matchAll(/<(rect|circle|path)\b([^>]*)>/g)].map((m) =>
    describeShape(m[1] ?? '', [...(m[2] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1] ?? '', a[2] ?? ''])),
  );
}

// JSX props are camelCase (strokeWidth); the SVG file uses stroke-width
function elementShapes(node: ReactNode): string[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    const { children, ...props } = child.props;
    const own =
      typeof child.type === 'string' && TAGS.includes(child.type)
        ? [describeShape(child.type, Object.entries(props).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(v)]))]
        : [];
    return [...own, ...elementShapes(children as ReactNode)];
  });
}

describe('BrandMark', () => {
  it('draws the same shapes as the tab icon', () => {
    const icon = readFileSync(new URL('../src/app/icon.svg', import.meta.url), 'utf8');
    const mark = elementShapes(BrandMark());
    expect(mark).toHaveLength(6);
    expect(mark).toEqual(svgShapes(icon));
  });
});
