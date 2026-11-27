import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import './ImageCarousel.css'

// The image carousel for one post's images. Moved out of PostBox.jsx (plan Task 10); the behaviour is the same:
// next and previous (wrapping), one dot per image, remove the shown image, and a counter.
export default function ImageCarousel({ images, imageIndex, readOnly, onRemoveCurrent, onPrev, onNext, onSelect }) {
  const img = images[imageIndex]
  const imageUrl = typeof img === 'string' ? img : img.url
  const many = images.length > 1

  return (
    <div className="image-carousel">
      <div className="image-carousel-frame">
        <img
          src={imageUrl}
          alt={`Preview ${imageIndex + 1}`}
          className="image-carousel-image"
          loading="lazy"
          decoding="async"
        />

        {!readOnly && (
          <div className="image-carousel-remove">
            <Button variant="danger" size="sm" title="Remove image" onClick={onRemoveCurrent}>
              Remove image
            </Button>
          </div>
        )}

        {many && (
          <>
            <div className="image-carousel-nav image-carousel-nav--prev">
              <IconButton icon="prev" mirror label="Previous image" onClick={onPrev} />
            </div>
            <div className="image-carousel-nav image-carousel-nav--next">
              <IconButton icon="next" mirror label="Next image" onClick={onNext} />
            </div>
          </>
        )}
      </div>

      {many && (
        <div className="image-carousel-footer">
          <div className="image-carousel-dots">
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`image-carousel-dot${idx === imageIndex ? ' is-active' : ''}`}
                title={`Image ${idx + 1}`}
                aria-label={`Image ${idx + 1}`}
                aria-current={idx === imageIndex ? 'true' : undefined}
                onClick={() => onSelect(idx)}
              >
                <span className="image-carousel-dot-mark" aria-hidden="true" />
              </button>
            ))}
          </div>
          <span className="image-carousel-counter">
            <bdi>{imageIndex + 1} / {images.length}</bdi>
          </span>
        </div>
      )}
    </div>
  )
}
