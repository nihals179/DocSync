import React from 'react';
import { ToolbarButton } from './ToolbarButton';

type HistoryControlsProps = {
  onUndo: () => void;
  onRedo: () => void;
};

/**
 * Undo and Redo buttons for document history navigation.
 */
export const HistoryControls: React.FC<HistoryControlsProps> = ({ onUndo, onRedo }) => (
  <>
    <ToolbarButton title="Undo (⌘Z)" icon="undo" onClick={onUndo} />
    <ToolbarButton title="Redo (⌘⇧Z)" icon="redo" onClick={onRedo} />
  </>
);
