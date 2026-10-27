import { Modal } from "react-daisyui";
import Button from "@/components/ui/button";

type Props = {
  bucketName: string;
  indexDocument: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Guards only the enable direction of the directory-listing toggle — see
 * overview-directory-listing.tsx. Website access already lets anyone fetch an
 * object whose exact name they know; a listing also tells them every name.
 * Purely presentational, like PublicAccessConfirm.
 */
const DirectoryListingConfirm = ({
  bucketName,
  indexDocument,
  isOpen,
  onCancel,
  onConfirm,
}: Props) => {
  return (
    <Modal open={isOpen}>
      <Modal.Header>Publish a directory listing?</Modal.Header>
      <Modal.Body>
        <p>
          Anyone who can reach the website for{" "}
          <span className="font-medium">{bucketName}</span> will see the name,
          size and date of every file in it, not only files whose address they
          already know.
        </p>
        <p className="mt-2">
          An <code>{indexDocument}</code> is written into every folder and kept
          up to date. Turning the listing off removes those pages again;
          website access stays on.
        </p>
      </Modal.Body>
      <Modal.Actions>
        <Button color="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="warning" onClick={onConfirm}>
          Publish listing
        </Button>
      </Modal.Actions>
    </Modal>
  );
};

export default DirectoryListingConfirm;
