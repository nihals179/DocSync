import { useNavigate } from 'react-router-dom';

const Header: React.FC = () => {
  const navigate = useNavigate();

  return (
    <header className="flex items-center border-b border-slate-200/70 bg-white/80 px-4 py-4 backdrop-blur-sm sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate('/workspace')}
        className="text-left"
        title="Go to workspace"
      >
        <p className="font-sans text-2xl font-extrabold tracking-tight text-slate-800 sm:text-3xl">
          DocSynq
          <span className="ml-3 text-base font-semibold text-cyan-700 sm:text-lg">
            Future of Workspace
          </span>
        </p>
      </button>
    </header>
  );
};

export default Header;
