// The Luma Studio API documentation — readable by anyone (signed in or not); using the API needs the add-on.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import docs from '../content/api-docs.md?raw';
import { Logo } from '../components/Logo';
import { usePageTitle } from '../lib/page-title';

export function DocsPage({ signedIn }: { signedIn: boolean }) {
  usePageTitle('API docs');
  const text = docs.replaceAll('{BASE}', window.location.origin);
  return (
    <div className="scroll-y h-full bg-white">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-8 flex items-center gap-3">
          <Link to="/" aria-label="Luma Studio"><Logo className="h-6" /></Link>
          <span className="ml-auto text-sm">
            {signedIn ? <Link to="/settings/addons" className="font-medium text-[#2970ec]">Get an API key →</Link> : <Link to="/login" className="font-medium text-[#2970ec]">Log in</Link>}
          </span>
        </div>
        <article className="md docs">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </article>
      </div>
    </div>
  );
}
