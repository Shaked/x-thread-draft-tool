import { useRef, useState } from 'react'
import Icon from '../ui/Icon'
import './ImageUpload.css'
import './UploadArea.css'

// The drop area and thumbnails of the one-time upload page (#418). Same look as the editor's drop area.
export default function UploadArea({ busy, remaining, thumbs, onFiles }) {
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef(null)
  const open = () => {
    if (!busy && remaining > 0) inputRef.current?.click()
  }
  const drag = (event) => {
    event.preventDefault()
    setDragActive(event.type === 'dragenter' || event.type === 'dragover')
  }
  return (
    <>
      {remaining > 0 && (
        <div className="image-upload">
          <div
            className={`image-upload-area${dragActive ? ' is-drag-active' : ''}${busy ? ' is-uploading' : ''}`}
            role="button"
            tabIndex={0}
            aria-disabled={busy}
            onDragEnter={drag}
            onDragLeave={drag}
            onDragOver={drag}
            onDrop={(event) => {
              drag(event)
              onFiles(event.dataTransfer.files)
            }}
            onClick={open}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              }
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Choose images"
              onChange={(event) => {
                onFiles(event.target.files)
                event.target.value = ''
              }}
            />
            {busy ? (
              <div className="image-upload-status" role="status" aria-live="polite">Uploading…</div>
            ) : (
              <div className="image-upload-prompt">
                <Icon name="image" size="lg" />
                <span>Drag, paste or click to add images ({remaining} left)</span>
              </div>
            )}
          </div>
        </div>
      )}
      {thumbs.length > 0 && (
        <div className="upload-thumbs">
          {thumbs.map((src) => (
            <img key={src} src={src} alt="Uploaded" />
          ))}
        </div>
      )}
    </>
  )
}
