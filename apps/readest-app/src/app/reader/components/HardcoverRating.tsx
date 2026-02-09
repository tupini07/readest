import React, { useState } from 'react';
import clsx from 'clsx';
import { MdStar, MdStarBorder } from 'react-icons/md';

interface HardcoverRatingProps {
  /** Current rating (0-5, 0 = unrated) */
  value: number;
  /** Called with new rating (0 to clear, 1-5 to set) */
  onChange: (rating: number) => void;
  /** Size of star icons */
  size?: number;
  /** Whether the rating is interactive */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
}

const HardcoverRating: React.FC<HardcoverRatingProps> = ({
  value,
  onChange,
  size = 20,
  disabled = false,
  className,
}) => {
  const [hoverValue, setHoverValue] = useState(0);
  const displayValue = hoverValue || value;

  const handleClick = (star: number) => {
    if (disabled) return;
    // Clicking the same star clears the rating
    onChange(star === value ? 0 : star);
  };

  return (
    <div
      className={clsx('flex items-center gap-0.5', className)}
      onMouseLeave={() => setHoverValue(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type='button'
          className={clsx(
            'transition-colors',
            disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:scale-110',
            displayValue >= star ? 'text-amber-400' : 'text-base-content/30',
          )}
          onClick={() => handleClick(star)}
          onMouseEnter={() => !disabled && setHoverValue(star)}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          {displayValue >= star ? <MdStar size={size} /> : <MdStarBorder size={size} />}
        </button>
      ))}
    </div>
  );
};

export default HardcoverRating;
