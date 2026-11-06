import { LayoutNode } from '../../types';

/**
 * Shared layout-engine contracts. The three engines (flow/position/table)
 * receive child layout through a ChildLayouter callback injected by the
 * dispatcher (calculate-positions.ts) to avoid circular imports — mirroring
 * Adobe's engine dispatch at xfalayout_disasm.c:15871-15926 where the
 * dispatcher constructs the engine per node and the engine recurses through
 * the dispatcher for children.
 */

export interface LayoutContext {
  /** Absolute x of the content origin for this node (page-1 content space). */
  x: number;
  /** Absolute y of the content origin for this node (page-1 content space). */
  y: number;
  /** Width available to the node's content box, in points. */
  availableWidth: number;
  /**
   * Absolute ("position") layout: a leaf without an authored `w` sizes to its
   * nominal width (minW) or content — NOT to the container width. Without this,
   * two positioned fields with only `minW` each expand to the full container
   * and overlap (seen in the cover-letter LeadTime blocks).
   */
  widthFromContent?: boolean;
}

export interface LayoutResult {
  node: LayoutNode;
  /** Extent of the node along the flow axis (height for tb/table, etc.). */
  height: number;
}

export type ChildLayouter = (node: LayoutNode, ctx: LayoutContext) => LayoutResult;
