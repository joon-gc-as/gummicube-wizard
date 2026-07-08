import 'dotenv/config';
import { GithubService } from '../github/github.service.ts';

async function cloneRepos() {
  const clonedResults = await GithubService.cloneAccessibleRepos()
  console.log('clonedResults: ', clonedResults);
}
cloneRepos()
