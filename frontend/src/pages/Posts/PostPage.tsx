import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import PostEditor from '../../components/posts/PostEditor';
import EmptyState from '../../components/ui/EmptyState';
import { paths } from '../../lib/paths';

/** A post on its own page (/posts/<id>): the editor with the live preview beside it on wide screens. */
export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const valid = Boolean(id && /^[a-f0-9]{24}$/i.test(id));

  const back = () => {
    // Came from inside the app: go back there; opened from a link: go to the Planner.
    if (window.history.state && window.history.state.idx > 0) navigate(-1);
    else navigate(paths.planner());
  };

  if (!valid) {
    return <EmptyState title="This post doesn’t exist" text="The link may be wrong, or the post was deleted." action={<Button onClick={() => navigate(paths.planner())}>Open the Planner</Button>} />;
  }

  return (
    <Box sx={{ maxWidth: 1240, mx: 'auto' }}>
      <Button size="small" startIcon={<BackIcon />} onClick={back} sx={{ mb: 1.5, ml: -1 }}>
        Back
      </Button>
      <PostEditor
        key={id}
        taskId={id!}
        variant="page"
        onDeleted={() => {
          window.dispatchEvent(new CustomEvent('post:deleted', { detail: id }));
          navigate(paths.planner(), { replace: true });
        }}
      />
    </Box>
  );
}
