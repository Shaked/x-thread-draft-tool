import Icon from '../ui/Icon'
import './ViewAsLock.css'

// While viewing as a user the admin sees counts only (#385). The words are fixed; the server decides what is shown.
export default function ViewAsLock() {
  return (
    <p className="view-as-lock">
      <Icon name="lock" />
      <span>Drafts are private. Viewing as shows counts only.</span>
    </p>
  )
}
