import { LayoutNode } from '../../types';

export interface LayoutContext {
  x: number;
  y: number;
  availableWidth: number;
  locale?: string;
  widthFromContent?: boolean;
  stretchWidth?: boolean;
  widthFromText?: boolean;
}

export interface LayoutResult {
  node: LayoutNode;
  height: number;
}

export type ChildLayouter = (node: LayoutNode, ctx: LayoutContext) => LayoutResult;
