import './Table.css'

// Rows of one kind of data. A real table from 768 px; below that each row becomes a card of label and value lines.
// `columns` is [{ key, label }]; each row is an object with those keys. The first column names the row.
export default function Table({ caption, columns, rows }) {
  return (
    <table className="ui-table">
      <caption className="ui-table__caption">{caption}</caption>
      <thead className="ui-table__head">
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[columns[0].key]} className="ui-table__row">
            {columns.map((column, index) =>
              index === 0 ? (
                <th key={column.key} scope="row" data-label={column.label}>
                  {row[column.key]}
                </th>
              ) : (
                <td key={column.key} data-label={column.label}>
                  {row[column.key]}
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
