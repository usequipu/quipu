import React, { useMemo } from 'react';
import fs from '../services/fileSystem';

const MediaViewer = ({ filePath, fileName }) => {
  const url = useMemo(() => fs.getFileUrl(filePath), [filePath]);
  const isImage = /\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(fileName);
  const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(fileName);

  return (
    <div className="flex-1 flex items-center justify-center overflow-auto bg-bg-surface p-8">
      {isImage && (
        <img
          src={url}
          alt={fileName}
          className="max-w-full max-h-full object-contain rounded shadow-md"
        />
      )}
      {isVideo && (
        <video
          src={url}
          controls
          className="max-w-full max-h-[80vh] rounded shadow-md"
        />
      )}
    </div>
  );
};

export default MediaViewer;
