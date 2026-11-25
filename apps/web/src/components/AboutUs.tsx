import { TEAM } from "@/lib/site";
import styles from "./aboutUs.module.css";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

export function AboutUs() {
  return (
    <section className={`marketplace-wrap ${styles.section}`} id="about" aria-labelledby="about-heading">
      <img className={styles.portrait} src={TEAM.portrait} alt={`${TEAM.founder}, founder of ADCode`} width={72} height={72} loading="lazy" decoding="async" />
      <div className={styles.copy}>
        <h2 id="about-heading">Built in the open. Built for you.</h2>
        <p>{TEAM.founder} and the team at Bluethenics are building ADCode with developers at the centre. The code is open, and we are inviting collaborators: <a href="/contribute">help build it</a>.</p>
      </div>
      <a href={TEAM.bookingUrl} className={styles.button} target="_blank" rel="noopener noreferrer">Talk to the team <Icon node={ArrowUpRight} /></a>
    </section>
  );
}
