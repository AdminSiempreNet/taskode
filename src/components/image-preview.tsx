"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpRight, Download, ImageIcon } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import styles from "./image-preview.module.css";

type PreviewImage = {
  src: string;
  name: string;
  meta?: string;
  downloadUrl?: string;
};
type OpenImage = (image: PreviewImage, trigger?: HTMLElement) => void;
const ImagePreviewContext = createContext<OpenImage | null>(null);

export function useImagePreview() {
  const open = useContext(ImagePreviewContext);
  if (!open)
    throw new Error("El visor de imágenes necesita ImagePreviewProvider.");
  return open;
}

export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<PreviewImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [dimensions, setDimensions] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const open = useCallback<OpenImage>((image, element) => {
    trigger.current =
      element ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setFailed(false);
    setDimensions("");
    setImage(image);
  }, []);
  return (
    <ImagePreviewContext.Provider value={open}>
      {children}
      <Dialog
        open={image !== null}
        onOpenChange={(open) => {
          if (!open) setImage(null);
        }}
      >
        <DialogContent
          data-image-preview=""
          className={styles.previewDialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected)
              trigger.current.focus({ preventScroll: true });
          }}
        >
          {image && (
            <>
              <header className={styles.previewHeader}>
                <ImageIcon size={20} aria-hidden="true" />
                <div>
                  <DialogTitle className={styles.previewTitle}>
                    {image.name}
                  </DialogTitle>
                  <DialogDescription>
                    {image.meta || dimensions || "Vista previa de imagen"}
                  </DialogDescription>
                </div>
              </header>
              <div className={styles.previewCanvas}>
                {failed ? (
                  <p>
                    No se pudo cargar la vista previa. Puedes abrir o descargar
                    el archivo.
                  </p>
                ) : (
                  <img
                    src={image.src}
                    alt={image.name}
                    onError={() => setFailed(true)}
                    onLoad={(event) =>
                      setDimensions(
                        `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight} px`,
                      )
                    }
                  />
                )}
              </div>
              <footer className={styles.previewFooter}>
                <a href={image.src} target="_blank" rel="noopener noreferrer">
                  <ArrowUpRight size={15} aria-hidden="true" />
                  Abrir original
                </a>
                <Button asChild size="sm">
                  <a href={image.downloadUrl ?? `${image.src}?download=1`}>
                    <Download size={15} aria-hidden="true" />
                    Descargar imagen
                  </a>
                </Button>
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ImagePreviewContext.Provider>
  );
}
