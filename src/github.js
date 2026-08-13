export class GitHubClient {
  constructor({ token, fetchImpl = fetch }) { if (!token) throw new Error("GitHub token is not configured"); this.token=token; this.fetch=fetchImpl; }
  async request(path, options={}) { const response=await this.fetch(`https://api.github.com${path}`,{...options,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${this.token}`,"x-github-api-version":"2022-11-28",...options.headers}}); if(!response.ok) throw new Error(`GitHub request failed (${response.status})`); return response.json(); }
  async listRepositories() { const rows=await this.request("/user/repos?visibility=all&affiliation=owner,collaborator&sort=updated&per_page=100"); return rows.map((repo)=>({fullName:repo.full_name,private:Boolean(repo.private),defaultBranch:repo.default_branch,updatedAt:repo.updated_at,permissions:{pull:Boolean(repo.permissions?.pull),push:Boolean(repo.permissions?.push)}})); }
  async createReviewPullRequest({ repo, baseSha, branch, baseBranch="main", patch }) {
    if (branch === baseBranch || branch === "main") throw new Error("Refusing to write directly to main");
    const base=await this.request(`/repos/${repo}/git/commits/${baseSha}`);
    const blob=await this.request(`/repos/${repo}/git/blobs`,{method:"POST",body:JSON.stringify({content:patch,encoding:"utf-8"})});
    const tree=await this.request(`/repos/${repo}/git/trees`,{method:"POST",body:JSON.stringify({base_tree:base.tree.sha,tree:[{path:`.deploy-doctor/proposals/${branch.split('/').at(-1)}.diff`,mode:"100644",type:"blob",sha:blob.sha}]})});
    const commit=await this.request(`/repos/${repo}/git/commits`,{method:"POST",body:JSON.stringify({message:"Add reviewed Deploy Doctor fix proposal",tree:tree.sha,parents:[baseSha]})});
    const ref=await this.request(`/repos/${repo}/git/refs`,{method:"POST",body:JSON.stringify({ref:`refs/heads/${branch}`,sha:commit.sha})});
    const pr=await this.request(`/repos/${repo}/pulls`,{method:"POST",body:JSON.stringify({title:"Deploy Doctor reviewed fix proposal",head:branch,base:baseBranch,body:"Contains the explicitly approved patch as an auditable artifact. Apply and review it before merging.",draft:true})});
    return { branchRef: ref.ref, prUrl: pr.html_url };
  }
}
