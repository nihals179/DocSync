import React, { useEffect, useRef, useState } from 'react';
import { ToolbarButton } from './ToolbarButton';

type TableInsertMenuProps = {
  onInsertTable: (rows: number, columns: number) => void;
};

const TABLE_MAX_ROWS = 8;
const TABLE_MAX_COLUMNS = 10;
const INSERT_COOLDOWN_MS = 300;

export const TableInsertMenu: React.FC<TableInsertMenuProps> = ({ onInsertTable }) => {
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const lastInsertAtRef = useRef(0);

  useEffect(() => {
    if (!showTableMenu) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!tableRef.current?.contains(target)) setShowTableMenu(false);
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [showTableMenu]);

  return (
    <div className="relative" ref={tableRef}>
      <ToolbarButton
        title="Insert table"
        icon="table_chart"
        active={showTableMenu}
        onClick={() => setShowTableMenu((prev) => !prev)}
      />

      {showTableMenu && (
        <div
          className="absolute left-0 top-9 z-80 w-53 rounded-xl border border-slate-300 bg-white p-2 shadow-xl ring-1 ring-slate-200 pointer-events-auto"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Insert table
          </div>
          <div className="mb-2 text-xs text-slate-700">{tableRows} x {tableColumns}</div>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${TABLE_MAX_COLUMNS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: TABLE_MAX_ROWS }).map((_, rowIndex) =>
              Array.from({ length: TABLE_MAX_COLUMNS }).map((__, colIndex) => {
                const active = rowIndex < tableRows && colIndex < tableColumns;
                return (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    aria-label={`Select ${rowIndex + 1} by ${colIndex + 1}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseEnter={() => {
                      setTableRows(rowIndex + 1);
                      setTableColumns(colIndex + 1);
                    }}
                    onFocus={() => {
                      setTableRows(rowIndex + 1);
                      setTableColumns(colIndex + 1);
                    }}
                    onClick={() => {
                      const now = Date.now();
                      if (now - lastInsertAtRef.current < INSERT_COOLDOWN_MS) return;
                      lastInsertAtRef.current = now;

                      const rows = rowIndex + 1;
                      const columns = colIndex + 1;
                      onInsertTable(rows, columns);
                      setTableRows(rows);
                      setTableColumns(columns);
                      setShowTableMenu(false);
                    }}
                    className={`h-4 w-4 rounded-[3px] border transition-colors ${active ? 'border-cyan-500 bg-cyan-400/70' : 'border-slate-300 bg-slate-50 hover:border-slate-400'}`}
                  />
                );
              }),
            )}
          </div>
        </div>
      )}
    </div>
  );
};