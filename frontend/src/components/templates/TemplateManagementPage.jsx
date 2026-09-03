import { Link } from 'react-router-dom';
import TemplateList from './TemplateList';

export default function TemplateManagementPage() {
  return (
    <div className="template-management-page">
      <div className="page-header">
        <h1>Template Management</h1>
        <Link to="/templates/create" className="btn-primary">+ Create Template</Link>
      </div>
      <TemplateList />
    </div>
  );
}
