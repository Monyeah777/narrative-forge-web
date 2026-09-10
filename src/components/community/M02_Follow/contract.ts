export type FollowLink = {
  id: string;
  label: string;
  href: string;
};

export type FollowProps = {
  heading: string;
  links: FollowLink[];
};
